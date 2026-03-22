import * as fs from 'fs';
import * as path from 'path';
import { compile, link, CompileResult, LinkResult } from './index';
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity } from './errors';
import { ASTBuilder } from './ast/builder';
import { Program, TopLevelDeclaration } from './ast/nodes';
import { SemanticResolver } from './semantics/resolver';
import { TypeChecker } from './semantics/checker';
import { PCodeGenerator } from './codegen/generator';
import { TObjWriter } from './tobj/writer';
import { Linker, LinkerOptions } from './linker/linker';
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
    type: 'basic' | 'header';
}

export interface ProjectCompileResult {
    tpc: Buffer | null;
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
            type: fileEntry['type'] === 'basic' ? 'basic' : 'header',
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

    compile(): ProjectCompileResult {
        const TibboBasicPreprocessor = require('../TibboBasicPreprocessor').default;
        const preprocessor = new TibboBasicPreprocessor(this.projectPath, this.platformsPath);

        preprocessor.parsePlatforms();

        const headerFiles = this.config.sourceFiles.filter(f => f.type === 'header');
        for (const hf of headerFiles) {
            preprocessor.parseFile(this.projectPath, hf.path, true);
        }

        const sourceFiles = this.config.sourceFiles.filter(f => f.type === 'basic');
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
        includedFiles.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

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
        const allErrors: Diagnostic[] = [];
        const allWarnings: Diagnostic[] = [];
        let totalGlobalAllocSize = 0;

        // Compile each .tbs file separately into its own OBJ
        for (const sf of sourceFiles) {
            const resolvedPath = preprocessor.parseFile(this.projectPath, sf.path, false);
            const fileContent = preprocessor.files[resolvedPath] as string || '';
            if (!fileContent || fileContent.replace(/\s/g, '').length === 0) continue;

            const headerLineCount = headerSource.split('\n').length;
            const perFileSource = this.expandDefines(
                headerSource + '\n' + fileContent,
                preprocessor.defines,
            );

            const baseName = path.basename(sf.path);
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
            });

            objs.set(baseName + '.obj', result.obj);
            allErrors.push(...result.errors);
            allWarnings.push(...result.warnings);
            totalGlobalAllocSize += result.globalAllocSize;
        }

        const buildId = this.options.fixedBuildId ?? this.generateBuildId();

        const linkerOptions: LinkerOptions = {
            projectName: this.config.name || 'project',
            buildId,
            firmwareVer: this.platformConfig.version,
            configStr: this.platformConfig.configStr,
            platformSize: this.platformConfig.platformId,
            globalAllocSize: totalGlobalAllocSize,
            stackSize: 0,
            localAllocSize: 0,
            maxEventNumber: maxEventNumber + 1,
            flags,
            fixedTimestamp: this.options.fixedTimestamp,
        };
        const objBuffers = [...objs.entries()].map(([name, data]) => ({ name, data }));
        const linkResult = link(objBuffers, {}, linkerOptions);

        return {
            tpc: linkResult.errors.length === 0 ? linkResult.tpc : null,
            objs,
            errors: [...allErrors, ...linkResult.errors],
            warnings: [...allWarnings, ...linkResult.warnings],
        };
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

    private buildCombinedSource(preprocessor: any): string {
        const parts: string[] = [];
        const processedPaths = new Set<string>();

        for (const filePath of preprocessor.filePriorities as string[]) {
            if (processedPaths.has(filePath)) continue;
            processedPaths.add(filePath);

            const content = preprocessor.files[filePath] as string;
            if (!content) continue;

            const trimmed = content.replace(/\s/g, '');
            if (trimmed.length === 0) continue;

            parts.push(content);
        }

        let combined = parts.join('\n');

        // Expand #define macros in the source code
        // The preprocessor handles conditionals but doesn't substitute defines in code text
        combined = this.expandDefines(combined, preprocessor.defines);

        return combined;
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
