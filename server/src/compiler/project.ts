import * as fs from 'fs';
import * as path from 'path';
import { compile, link, CompileResult, LinkResult, LinkerOptions, SourceMapEntry } from './index';
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity } from './errors';
import { ASTBuilder } from './ast/builder';
import { Program, TopLevelDeclaration } from './ast/nodes';
import { SemanticResolver } from './semantics/resolver';
import { TypeChecker } from './semantics/checker';
import { PCodeGenerator } from './codegen/generator';
import { TObjWriter } from './tobj/writer';
import { TObjHeaderFlags } from './tobj/format';
import { resolvePathInsensitive } from '../pathUtils';

/* eslint-disable @typescript-eslint/no-var-requires */
const ini = require('ini');

export interface PlatformConfig {
    version: string;
    codebits: number;
    databits: number;
    platformId: number;
    configStr: string;
    maxEventNumber: number;
}

export interface ProjectConfig {
    name: string;
    output: string;
    debug: boolean;
    platform: string;
    srcLibVer: string;
    sourceFiles: ProjectFile[];
}

export interface ProjectFile {
    path: string;
    type: 'basic' | 'header' | 'resource';
}

export interface ProjectCompileResult {
    tpc: Buffer | null;
    pdb: Buffer | null;
    objs: Map<string, Buffer>;
    errors: Diagnostic[];
    warnings: Diagnostic[];
}

export function parseProjectFile(tprPath: string): ProjectConfig {
    const content = fs.readFileSync(tprPath, 'utf-8');
    const tpr = ini.parse(content);

    const project = tpr['project'] || {};
    const config: ProjectConfig = {
        name: project['name'] || '',
        output: project['output'] || '',
        debug: project['debug'] === 'on',
        platform: project['platform'] || '',
        srcLibVer: project['src_lib_ver'] || '0_00',
        sourceFiles: [],
    };

    let fileIdx = 1;
    while (tpr[`file${fileIdx}`]) {
        const fileEntry = tpr[`file${fileIdx}`];
        config.sourceFiles.push({
            path: fileEntry['path'] || '',
            type: fileEntry['type'] === 'basic' ? 'basic'
                : fileEntry['type'] === 'header' ? 'header'
                : 'resource',
        });
        fileIdx++;
    }

    return config;
}

export interface ProjectCompilerOptions {
    fixedBuildId?: string;
    fixedTimestamp?: Date;
}

export class ProjectCompiler {
    private projectPath: string;
    private platformsPath: string;
    private config: ProjectConfig;
    private platformConfig: PlatformConfig;
    private diagnostics: DiagnosticCollection;
    private preprocessedFiles = new Map<string, string>();
    private allDeclarations: TopLevelDeclaration[] = [];
    private options: ProjectCompilerOptions;

    constructor(projectPath: string, platformsPath?: string, options?: ProjectCompilerOptions) {
        this.projectPath = projectPath;
        this.platformsPath = platformsPath || path.join(projectPath, 'Platforms');
        if (!fs.existsSync(this.platformsPath)) {
            this.platformsPath = path.join(__dirname, '..', '..', '..', 'platforms', 'Platforms');
        }
        this.diagnostics = new DiagnosticCollection();
        this.options = options || {};

        const tprPath = this.findTprFile();
        this.config = parseProjectFile(tprPath);
        this.platformConfig = this.loadPlatformConfig();
    }

    private findTprFile(): string {
        const files = fs.readdirSync(this.projectPath);
        const tpr = files.find(f => path.extname(f) === '.tpr');
        if (!tpr) throw new Error(`No .tpr project file found in ${this.projectPath}`);
        return path.join(this.projectPath, tpr);
    }

    private loadPlatformConfig(): PlatformConfig {
        const result: PlatformConfig = { version: '', codebits: 16, databits: 16, platformId: 0, configStr: '', maxEventNumber: 32 };
        const platformDir = resolvePathInsensitive(this.platformsPath, this.config.platform)
            || path.join(this.platformsPath, this.config.platform);
        const tpFile = resolvePathInsensitive(platformDir, this.config.platform + '.tp');
        if (tpFile) {
            const tp = ini.parse(fs.readFileSync(tpFile, 'utf-8'));
            const platform = tp['platform'] || {};
            result.version = platform['version'] || '';
            result.codebits = parseInt(platform['codebits'] || '16', 10);
            result.databits = parseInt(platform['databits'] || '16', 10);
        }

        const tphFile = resolvePathInsensitive(platformDir, this.config.platform + '.tph');
        if (tphFile) {
            const content = fs.readFileSync(tphFile, 'utf-8');
            const pidMatch = content.match(/#define\s+PLATFORM_ID\s+(\d+)/);
            if (pidMatch) result.platformId = parseInt(pidMatch[1], 10);
            const cfgMatch = content.match(/#define\s+__cfgstr\s+"([^"]*)"/);
            if (cfgMatch) result.configStr = cfgMatch[1];
            const type32Match = content.match(/#define\s+PLATFORM_TYPE_32\s+(\d+)/);
            if (type32Match && type32Match[1] === '1') {
                if (result.codebits < 24) result.codebits = 24;
                if (result.databits < 32) result.databits = 32;
            }
        }

        return result;
    }

    private getCompilerFlags(): number {
        let flags = 0;
        if (this.config.debug) flags |= TObjHeaderFlags.Debug;
        if (this.platformConfig.codebits >= 24) flags |= TObjHeaderFlags.Code24;
        if (this.platformConfig.databits >= 32) flags |= TObjHeaderFlags.Data32;
        if (this.platformConfig.databits >= 32) flags |= TObjHeaderFlags.Reg32;
        return flags;
    }

    compile(extraLinkerOptions?: Partial<LinkerOptions>): ProjectCompileResult {
        const TibboBasicPreprocessor = require('../TibboBasicPreprocessor').default;
        const preprocessor = new TibboBasicPreprocessor(this.projectPath, this.platformsPath);

        preprocessor.parsePlatforms();

        const headerFiles = this.config.sourceFiles.filter(f => f.type === 'header');
        for (const hf of headerFiles) {
            preprocessor.parseFile(this.projectPath, hf.path, true);
        }

        const sourceFiles = this.config.sourceFiles.filter(f => f.type === 'basic');
        const resourceFiles = this.config.sourceFiles.filter(f => f.type === 'resource');
        for (const sf of sourceFiles) {
            preprocessor.parseFile(this.projectPath, sf.path, true);
        }

        for (const [filePath, content] of Object.entries(preprocessor.files as Record<string, string>)) {
            this.preprocessedFiles.set(filePath, content);
        }

        // Build shared header source from platform and .tbh files
        const headerSource = this.buildHeaderSource(preprocessor);

        // Collect included file paths (non-.tbs) in preprocessor order
        const sourceFileBasenames = new Set(
            this.config.sourceFiles
                .filter(f => f.type === 'basic')
                .map(f => path.basename(f.path)),
        );
        const includedFiles: string[] = [];
        const seenPaths = new Set<string>();
        for (const filePath of preprocessor.filePriorities as string[]) {
            const key = filePath.toLowerCase();
            if (seenPaths.has(key)) continue;
            seenPaths.add(key);
            const basename = path.basename(filePath);
            if (sourceFileBasenames.has(basename)) continue;
            includedFiles.push(filePath);
        }
        // Keep preprocessor discovery order (filePriorities). Sorting alphabetically
        // breaks byte parity with tmake: IncNameDir + symbol string offsets must match.

        // File processing sequence (includes re-entries for LineInfo blocks)
        const includeOrder: Map<string, string[]> = preprocessor.includeOrder || new Map();
        const filesWithContentAfterLastInclude = new Set<string>();
        for (const [parentPath, children] of includeOrder.entries()) {
            if (children.length === 0) continue;
            const origContent = preprocessor.originalFiles[parentPath] as string;
            if (!origContent) continue;
            const lines = origContent.split('\n');
            let lastIncludeLine = -1;
            for (let li = 0; li < lines.length; li++) {
                if (/^\s*(include|includepp)\s+/i.test(lines[li])) lastIncludeLine = li;
            }
            if (lastIncludeLine >= 0) {
                const afterLastInclude = lines.slice(lastIncludeLine + 1);
                const hasContent = afterLastInclude.some(l => {
                    const t = l.trim();
                    return t.length > 0 && !t.startsWith("'") && !t.startsWith('#');
                });
                if (hasContent) filesWithContentAfterLastInclude.add(parentPath);
            }
        }

        const emptyFiles = new Set<string>();
        for (const fp of Object.keys(preprocessor.files)) {
            const content = preprocessor.files[fp] as string;
            if (!content) continue;
            const hasCode = content.split('\n').some(l => {
                const t = l.trim();
                return t.length > 0 && !t.startsWith("'") && !t.startsWith('#');
            });
            if (!hasCode) emptyFiles.add(fp);
        }

        const fileSequence: string[] = [];
        const emitFileSequence = (filePath: string) => {
            const basename = path.basename(filePath);
            if (sourceFileBasenames.has(basename)) return;
            if (basename.toLowerCase() === 'global.tbh') return;
            if (emptyFiles.has(filePath)) return;
            fileSequence.push(filePath);
            const children = includeOrder.get(filePath) || [];
            const validChildren = children.filter(c => !emptyFiles.has(c) && !sourceFileBasenames.has(path.basename(c)) && path.basename(c).toLowerCase() !== 'global.tbh');
            for (let i = 0; i < validChildren.length; i++) {
                emitFileSequence(validChildren[i]);
                const isLast = i === validChildren.length - 1;
                if (!isLast || filesWithContentAfterLastInclude.has(filePath)) {
                    fileSequence.push(filePath);
                }
            }
        };
        const rootPlatformFile = (preprocessor.lineInfoFileSequence || preprocessor.fileSequence)[0] as string;
        if (rootPlatformFile) emitFileSequence(rootPlatformFile);

        const flags = this.getCompilerFlags();
        const maxEventNumber = this.platformConfig.maxEventNumber;
        const objs = new Map<string, Buffer>();
        const objDescriptors = new Map<string, { initOffset: number; data: number[]; isInit: boolean }[]>();
        const allErrors: Diagnostic[] = [];
        const allWarnings: Diagnostic[] = [];
        let totalGlobalAllocSize = 0;
        let maxLocalAllocSize = 0;
        let maxStackSize = 0;

        // First pass: compile each .tbs file separately into its own OBJ
        interface FirstPassEntry {
            baseName: string;
            objName: string;
            perFileSource: string;
            sourceFilePath: string;
            headerLineCount: number;
            result: CompileResult;
        }
        const firstPassEntries: FirstPassEntry[] = [];

        for (const sf of sourceFiles) {
            const baseName = path.basename(sf.path);
            try {
                const resolvedPath = preprocessor.parseFile(this.projectPath, sf.path, false);
                const fileContent = preprocessor.files[resolvedPath] as string || '';
                if (!fileContent || fileContent.replace(/\s/g, '').length === 0) continue;

                const headerLineCount = headerSource.split('\n').length;
                const perFileSource = this.expandDefines(
                    headerSource + '\n' + fileContent,
                    preprocessor.defines,
                );

                const sourceFilePath = path.resolve(this.projectPath, sf.path);
                const result = compile(perFileSource, {
                    fileName: baseName,
                    flags,
                    maxEventNumber,
                    platformSize: this.platformConfig.platformId,
                    headerLineCount,
                    includedFiles,
                    fileSequence,
                    sourceFilePath,
                    firmwareVer: this.platformConfig.version,
                    configStr: this.platformConfig.configStr,
                    projectName: this.config.name,
                });

                const objName = baseName + '.obj';
                objs.set(objName, result.obj);
                if (result.initObjDescriptors.length > 0) {
                    objDescriptors.set(objName, result.initObjDescriptors);
                }
                allErrors.push(...result.errors);
                allWarnings.push(...result.warnings);
                totalGlobalAllocSize += result.globalAllocSize;
                if (result.localAllocSize > maxLocalAllocSize) {
                    maxLocalAllocSize = result.localAllocSize;
                }
                if (result.stackSize > maxStackSize) {
                    maxStackSize = result.stackSize;
                }
                firstPassEntries.push({
                    baseName, objName, perFileSource, sourceFilePath, headerLineCount, result,
                });
            } catch (e) {
                allErrors.push({
                    severity: DiagnosticSeverity.Error,
                    location: { file: baseName, line: 1, column: 0 },
                    message: `Failed to compile ${baseName}: ${e instanceof Error ? e.message : String(e)}`,
                });
            }
        }

        // Second pass: recompile files that need project-wide stackSize / localAllocSize
        if (firstPassEntries.length > 1 && allErrors.length === 0) {
            let maxStep4 = 0;
            for (const entry of firstPassEntries) {
                if (entry.result.localAllocSizeBeforeCalledFuncs > maxStep4) {
                    maxStep4 = entry.result.localAllocSizeBeforeCalledFuncs;
                }
            }

            const projectCalleeNamesLower = this.collectProjectCalleeNamesLower(firstPassEntries);

            for (const entry of firstPassEntries) {
                const needsStackSizeFix = entry.result.stackSize < maxStackSize;
                const needsLocalAllocFix = entry.result.localAllocSizeBeforeCalledFuncs < maxStep4;
                const needsGlobalFix = entry.result.globalAllocSize < totalGlobalAllocSize;
                if (!needsStackSizeFix && !needsLocalAllocFix && !needsGlobalFix) continue;

                const result = compile(entry.perFileSource, {
                    fileName: entry.baseName,
                    flags,
                    maxEventNumber,
                    platformSize: this.platformConfig.platformId,
                    headerLineCount: entry.headerLineCount,
                    includedFiles,
                    fileSequence,
                    sourceFilePath: entry.sourceFilePath,
                    firmwareVer: this.platformConfig.version,
                    configStr: this.platformConfig.configStr,
                    projectName: this.config.name,
                    projectGlobalAllocSize: totalGlobalAllocSize,
                    projectCalleeNamesLower,
                    ...(needsStackSizeFix && {
                        projectOverrideStackSize: maxStackSize,
                    }),
                    ...(needsLocalAllocFix && {
                        minLocalAllocSizeBeforeTemp: maxStep4,
                    }),
                });

                objs.set(entry.objName, result.obj);
                if (result.initObjDescriptors.length > 0) {
                    objDescriptors.set(entry.objName, result.initObjDescriptors);
                } else {
                    objDescriptors.delete(entry.objName);
                }
                if (result.localAllocSize > maxLocalAllocSize) {
                    maxLocalAllocSize = result.localAllocSize;
                }
            }
        }

        for (const rf of resourceFiles) {
            try {
                const result = this.compileHtmlResource(
                    rf,
                    headerSource,
                    flags,
                    maxEventNumber,
                    includedFiles,
                    fileSequence,
                    preprocessor.defines,
                );
                if (!result) continue;

                objs.set(path.basename(rf.path) + '.obj', result.obj);
                allErrors.push(...result.errors);
                allWarnings.push(...result.warnings);
                totalGlobalAllocSize += result.globalAllocSize;
                if (result.localAllocSize > maxLocalAllocSize) {
                    maxLocalAllocSize = result.localAllocSize;
                }
                if (result.stackSize > maxStackSize) {
                    maxStackSize = result.stackSize;
                }
            } catch (e) {
                allErrors.push({
                    severity: DiagnosticSeverity.Error,
                    location: { file: path.basename(rf.path), line: 1, column: 0 },
                    message: `Failed to compile resource ${rf.path}: ${e instanceof Error ? e.message : String(e)}`,
                });
            }
        }

        if (allErrors.length > 0) {
            return { tpc: null, pdb: null, objs, errors: allErrors, warnings: allWarnings };
        }

        const buildId = this.options.fixedBuildId ?? this.generateBuildId();
        const stackSize = maxStackSize;
        const linkedResources = this.config.sourceFiles
            .filter(f => f.type === 'resource' && path.extname(f.path).toLowerCase() !== '.html')
            .map(f => ({
                name: path.basename(f.path),
                data: fs.readFileSync(path.resolve(this.projectPath, f.path)),
            }));

        const linkerOptions: LinkerOptions = {
            projectName: this.config.name || 'project',
            buildId,
            firmwareVer: this.platformConfig.version,
            configStr: this.platformConfig.configStr,
            platformSize: this.platformConfig.platformId,
            globalAllocSize: totalGlobalAllocSize,
            stackSize,
            localAllocSize: maxLocalAllocSize,
            maxEventNumber: maxEventNumber + 1,
            flags,
            fixedTimestamp: this.options.fixedTimestamp,
            resources: linkedResources,
        };
        const objBuffers = [...objs.entries()].map(([name, data]) => ({
            name,
            data,
            initObjDescriptors: objDescriptors.get(name),
        }));
        const mergedLinkerOptions = extraLinkerOptions
            ? { ...linkerOptions, ...extraLinkerOptions }
            : linkerOptions;
        const linkResult = link(objBuffers, {}, mergedLinkerOptions);
        const pdb = linkResult.errors.length === 0 ? linkResult.pdb : null;
        this.writeProjectArtifacts(objs, pdb);

        return {
            tpc: linkResult.errors.length === 0 ? linkResult.tpc : null,
            pdb,
            objs,
            errors: [...allErrors, ...linkResult.errors],
            warnings: [...allWarnings, ...linkResult.warnings],
        };
    }

    /** Union of `ident(` call targets across all first-pass compilation units (lowercase). */
    private collectProjectCalleeNamesLower(entries: { result: CompileResult }[]): Set<string> {
        const out = new Set<string>();
        const walk = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            if (n.kind === 'CallExpr') {
                const callee = n.callee as Record<string, unknown> | undefined;
                if (callee?.kind === 'IdentifierExpr' && typeof callee.name === 'string') {
                    out.add(callee.name.toLowerCase());
                }
            }
            for (const key of Object.keys(n)) {
                if (key === 'loc' || key === 'kind') continue;
                const child = n[key];
                if (Array.isArray(child)) {
                    for (const c of child) walk(c);
                } else if (child && typeof child === 'object' && (child as Record<string, unknown>).kind) {
                    walk(child);
                }
            }
        };
        for (const e of entries) {
            for (const decl of e.result.ast.declarations) {
                walk(decl);
            }
        }
        return out;
    }

    private buildHeaderSource(preprocessor: any): string {
        const sourceFileBasenames = new Set(
            this.config.sourceFiles
                .filter(f => f.type === 'basic')
                .map(f => path.basename(f.path)),
        );

        const includeOrder: Map<string, string[]> = preprocessor.includeOrder || new Map();
        const expanded = new Set<string>();
        const includeRe = /^\s*(include|includepp)\s+/i;

        const expand = (filePath: string): string => {
            if (expanded.has(filePath)) return '';
            expanded.add(filePath);

            const basename = path.basename(filePath);
            if (sourceFileBasenames.has(basename)) return '';

            const content = preprocessor.files[filePath] as string;
            if (!content) return '';
            if (content.replace(/\s/g, '').length === 0) return '';

            const childIncludes = includeOrder.get(filePath) || [];
            if (childIncludes.length === 0) return content;

            const lines = content.split('\n');
            const result: string[] = [];
            let childIdx = 0;

            for (const line of lines) {
                if (includeRe.test(line) && childIdx < childIncludes.length) {
                    result.push(' '.repeat(line.length));
                    result.push(expand(childIncludes[childIdx]));
                    childIdx++;
                } else {
                    result.push(line);
                }
            }
            return result.join('\n');
        };

        const parts: string[] = [];
        for (const filePath of preprocessor.filePriorities as string[]) {
            if (expanded.has(filePath)) continue;
            const content = expand(filePath);
            if (content && content.replace(/\s/g, '').length > 0) {
                parts.push(content);
            }
        }

        return parts.join('\n');
    }

    private buildCombinedSource(preprocessor: any): { source: string; sourceMap: SourceMapEntry[] } {
        const parts: string[] = [];
        const sourceMap: SourceMapEntry[] = [];
        const processedPaths = new Set<string>();
        let currentLine = 1;

        for (const filePath of preprocessor.filePriorities as string[]) {
            if (processedPaths.has(filePath)) continue;
            processedPaths.add(filePath);

            const content = preprocessor.files[filePath] as string;
            if (!content) continue;

            const trimmed = content.replace(/\s/g, '');
            if (trimmed.length === 0) continue;

            const lineCount = content.split('\n').length;
            sourceMap.push({ filePath, combinedStartLine: currentLine, lineCount });
            parts.push(content);
            currentLine += lineCount;
        }

        let combined = parts.join('\n');
        combined = this.expandDefines(combined, preprocessor.defines);

        return { source: combined, sourceMap };
    }

    private compileHtmlResource(
        file: ProjectFile,
        headerSource: string,
        flags: number,
        maxEventNumber: number,
        includedFiles: string[],
        fileSequence: string[],
        defines: Record<string, { name: string; value: string }>,
    ): CompileResult | null {
        if (path.extname(file.path).toLowerCase() !== '.html') {
            return null;
        }

        const absPath = path.resolve(this.projectPath, file.path);
        const rawContent = fs.readFileSync(absPath);
        const htmlContent = rawContent.toString('utf-8');
        const scriptBlocks: string[] = [];
        const scriptRe = /<\?([\s\S]*?)\?>/g;
        let match: RegExpExecArray | null;
        while ((match = scriptRe.exec(htmlContent)) !== null) {
            const block = this.preprocessResourceScript(match[1], defines)
                .split('\n')
                .filter(line => !/^\s*(include|includepp)\s+/i.test(line))
                .join('\n')
                .trim();
            scriptBlocks.push(block);
        }
        const handlerName = `_html_${path.basename(file.path).replace(/[^A-Za-z0-9_]/g, '_')}`;
        const headerLineCount = headerSource.split('\n').length;
        const wrapperBody = scriptBlocks.filter(Boolean).join('\n\n');
        const syntheticSource = `${headerSource}\nsub ${handlerName}()\n${wrapperBody}\nend sub\n`;
        const placeholder = /^upload_/i.test(path.basename(file.path)) ? '~000000' : '~000000\r\n';
        const payload = scriptBlocks.length > 0
            ? Buffer.from(placeholder, 'latin1')
            : rawContent;

        return compile(this.expandDefines(syntheticSource, defines), {
            fileName: path.basename(file.path),
            flags,
            maxEventNumber,
            platformSize: this.platformConfig.platformId,
            headerLineCount,
            includedFiles,
            fileSequence,
            sourceFilePath: absPath,
            firmwareVer: this.platformConfig.version,
            configStr: this.platformConfig.configStr,
            fileData: payload,
            resourceEntries: [{ name: path.basename(file.path), dataOffset: 0, size: payload.length }],
        });
    }

    private preprocessResourceScript(source: string, defines: Record<string, { name: string; value: string }>): string {
        type ConditionalFrame = {
            parentActive: boolean;
            active: boolean;
            branchTaken: boolean;
        };

        const lines = source.split('\n');
        const output: string[] = [];
        const stack: ConditionalFrame[] = [];

        const isActive = (): boolean => stack.every(frame => frame.active);
        const currentParentActive = (): boolean => stack.every(frame => frame.parentActive && frame.active);

        for (const line of lines) {
            const trimmed = line.trim();
            let match = trimmed.match(/^#ifdef\s+([A-Za-z_][A-Za-z0-9_]*)/i);
            if (match) {
                const parentActive = isActive();
                const cond = defines[match[1]] !== undefined;
                stack.push({ parentActive, active: parentActive && cond, branchTaken: cond });
                continue;
            }

            match = trimmed.match(/^#ifndef\s+([A-Za-z_][A-Za-z0-9_]*)/i);
            if (match) {
                const parentActive = isActive();
                const cond = defines[match[1]] === undefined;
                stack.push({ parentActive, active: parentActive && cond, branchTaken: cond });
                continue;
            }

            match = trimmed.match(/^#if\s+(.+)$/i);
            if (match) {
                const parentActive = isActive();
                const cond = this.evaluateResourceCondition(match[1], defines);
                stack.push({ parentActive, active: parentActive && cond, branchTaken: cond });
                continue;
            }

            match = trimmed.match(/^#elif\s+(.+)$/i);
            if (match && stack.length > 0) {
                const frame = stack[stack.length - 1];
                const cond = !frame.branchTaken && this.evaluateResourceCondition(match[1], defines);
                frame.active = frame.parentActive && cond;
                frame.branchTaken = frame.branchTaken || cond;
                continue;
            }

            if (/^#else\b/i.test(trimmed) && stack.length > 0) {
                const frame = stack[stack.length - 1];
                frame.active = frame.parentActive && !frame.branchTaken;
                frame.branchTaken = true;
                continue;
            }

            if (/^#endif\b/i.test(trimmed) && stack.length > 0) {
                stack.pop();
                continue;
            }

            if (/^#/.test(trimmed)) {
                continue;
            }

            if (isActive()) {
                output.push(line);
            }
        }

        return output.join('\n');
    }

    private evaluateResourceCondition(expr: string, defines: Record<string, { name: string; value: string }>): boolean {
        const normalized = expr
            .replace(/<>/g, '!=')
            .replace(/\bAND\b/gi, '&&')
            .replace(/\bOR\b/gi, '||')
            .replace(/(^|[^<>!])=([^=]|$)/g, '$1==$2')
            .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (token, name: string) => {
                const def = defines[name];
                if (!def) return '0';
                const value = def.value.trim();
                if (value === '') return '1';
                if (/^-?\d+(\.\d+)?$/.test(value)) return value;
                return JSON.stringify(value);
            });

        try {
            return !!Function(`return (${normalized});`)();
        } catch {
            return false;
        }
    }

    private expandDefines(source: string, defines: Record<string, { name: string; value: string }>): string {
        // Sort defines by name length descending to avoid partial matches
        const sortedDefines = Object.entries(defines)
            .filter(([, d]) => d && d.value !== '')
            .sort(([a], [b]) => b.length - a.length);

        if (sortedDefines.length === 0) return source;

        // Build a map for fast lookups
        const defineMap = new Map<string, string>();
        for (const [name, def] of sortedDefines) {
            defineMap.set(name, def.value);
        }

        // Resolve nested defines
        const resolveValue = (val: string, depth = 0): string => {
            if (depth > 10) return val;
            const resolved = defineMap.get(val);
            if (resolved !== undefined && resolved !== val) {
                return resolveValue(resolved, depth + 1);
            }
            return val;
        };

        // Replace defines in source using word-boundary matching
        // Skip lines that are preprocessor directives themselves
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trimStart();
            if (trimmedLine.startsWith('#')) continue;
            if (trimmedLine.startsWith("'")) continue;

            // Replace defines in this line
            for (const [name] of sortedDefines) {
                if (!lines[i].includes(name)) continue;
                const resolved = resolveValue(name);
                // Use word-boundary regex to avoid partial matches
                const regex = new RegExp('\\b' + this.escapeRegex(name) + '\\b', 'g');
                lines[i] = lines[i].replace(regex, resolved);
            }
        }

        return lines.join('\n');
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private writeProjectArtifacts(objs: Map<string, Buffer>, pdb: Buffer | null): void {
        const tmpDir = path.join(this.projectPath, 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });

        for (const fileName of fs.readdirSync(tmpDir)) {
            if (fileName.endsWith('.obj') || fileName.endsWith('.pdb')) {
                fs.unlinkSync(path.join(tmpDir, fileName));
            }
        }

        for (const [name, data] of objs) {
            fs.writeFileSync(path.join(tmpDir, name), data);
        }

        if (pdb && pdb.length > 0) {
            fs.writeFileSync(path.join(tmpDir, 'database.pdb'), pdb);
        }
    }

    private generateBuildId(): string {
        const hex = (n: number) => n.toString(16).padStart(2, '0');
        const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return [
            bytes.slice(0, 4).map(b => hex(b)).join(''),
            bytes.slice(4, 6).map(b => hex(b)).join(''),
            bytes.slice(6, 8).map(b => hex(b)).join(''),
            bytes.slice(8, 10).map(b => hex(b)).join(''),
            bytes.slice(10, 16).map(b => hex(b)).join(''),
        ].join('-');
    }

    getConfig(): ProjectConfig {
        return this.config;
    }
}
