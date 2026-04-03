import { ASTBuilder } from './ast/builder';
import { Program } from './ast/nodes';
import { DiagnosticCollection, Diagnostic } from './errors';
import { SemanticResolver } from './semantics/resolver';
import { TypeChecker } from './semantics/checker';
import { PCodeGenerator } from './codegen/generator';
import { TObjWriter } from './tobj/writer';
import { Linker, LinkerOptions } from './linker/linker';

/* eslint-disable @typescript-eslint/no-var-requires */
const antlr4 = require('antlr4');
const TibboBasicLexer = require('../../language/TibboBasic/lib/TibboBasicLexer').TibboBasicLexer;
const TibboBasicParser = require('../../language/TibboBasic/lib/TibboBasicParser').TibboBasicParser;

export interface SourceMapEntry {
    filePath: string;
    combinedStartLine: number;
    lineCount: number;
}

export interface CompileOptions {
    fileName?: string;
    defines?: Record<string, string>;
    includePaths?: string[];
    flags?: number;
    maxEventNumber?: number;
    platformSize?: number;
    headerLineCount?: number;
    includedFiles?: string[];
    fileSequence?: string[];
    sourceFilePath?: string;
    firmwareVer?: string;
    fileData?: Buffer;
    resourceEntries?: Array<{ name: string; dataOffset: number; size: number }>;
    sourceMap?: SourceMapEntry[];
    resolveDataAddresses?: boolean;
    stackSize?: number;
    projectOverrideStackSize?: number;
    minLocalAllocSizeBeforeTemp?: number;
    /** When set (multi-file projects), only these sub/function names get the pre-temp scratch under non-event roots. */
    projectCalleeNamesLower?: Set<string>;
    projectGlobalAllocSize?: number;
    projectName?: string;
    buildId?: string;
    configStr?: string;
}

export interface InitObjDescriptor {
    initOffset: number;
    data: number[];
    isInit: boolean;
}

export interface CompileResult {
    obj: Buffer;
    ast: Program;
    errors: Diagnostic[];
    warnings: Diagnostic[];
    globalAllocSize: number;
    localAllocSize: number;
    stackSize: number;
    localAllocSizeBeforeCalledFuncs: number;
    initObjDescriptors: InitObjDescriptor[];
}

export interface LinkOptions {
    outputName?: string;
}

export interface LinkResult {
    tpc: Buffer;
    errors: Diagnostic[];
    warnings: Diagnostic[];
}

export function parse(source: string, fileName = '<input>'): { tree: any; errors: any[] } {
    const chars = new antlr4.InputStream(source);
    const lexer = new TibboBasicLexer(chars);
    const tokens = new antlr4.CommonTokenStream(lexer);
    const parser = new TibboBasicParser(tokens);
    parser.buildParseTrees = true;

    const errors: any[] = [];
    const errorListener = {
        syntaxError(_recognizer: any, _offendingSymbol: any, line: number, column: number, msg: string) {
            errors.push({ line, column, message: msg });
        },
        reportAmbiguity() {},
        reportAttemptingFullContext() {},
        reportContextSensitivity() {},
    };

    lexer.removeErrorListeners();
    parser.removeErrorListeners();
    parser.addErrorListener(errorListener);

    const tree = parser.startRule();
    return { tree, errors };
}

export function buildAST(source: string, fileName = '<input>'): { ast: Program; parseErrors: any[] } {
    const { tree, errors: parseErrors } = parse(source, fileName);
    const builder = new ASTBuilder(fileName);
    const ast = builder.buildProgram(tree);
    return { ast, parseErrors };
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
    const fileName = options.fileName ?? '<input>';
    const diagnostics = new DiagnosticCollection();
    const emptyResult: CompileResult = {
        obj: Buffer.alloc(0),
        ast: { kind: 'Program', declarations: [], loc: { file: fileName, line: 1, column: 0 } },
        errors: [],
        warnings: [],
        globalAllocSize: 0,
        localAllocSize: 0,
        stackSize: 0,
        localAllocSizeBeforeCalledFuncs: 0,
        initObjDescriptors: [],
    };

    let ast: Program;
    try {
        const result = buildAST(source, fileName);
        ast = result.ast;
        for (const e of result.parseErrors) {
            diagnostics.error({ file: fileName, line: e.line, column: e.column }, e.message, 'PARSE');
        }
    } catch (e) {
        diagnostics.error({ file: fileName, line: 1, column: 0 }, `Parse failed: ${e instanceof Error ? e.message : String(e)}`, 'PARSE');
        return { ...emptyResult, errors: diagnostics.getErrors(), warnings: diagnostics.getWarnings() };
    }

    let resolver: SemanticResolver;
    let checker: TypeChecker;
    try {
        resolver = new SemanticResolver(diagnostics);
        resolver.resolve(ast);

        checker = new TypeChecker(resolver.symbols, diagnostics, resolver);
        checker.check(ast);
    } catch (e) {
        diagnostics.error({ file: fileName, line: 1, column: 0 }, `Semantic analysis failed: ${e instanceof Error ? e.message : String(e)}`, 'SEMANTIC');
        return { ...emptyResult, ast, errors: diagnostics.getErrors(), warnings: diagnostics.getWarnings() };
    }

    const flags = options.flags ?? 0;
    const useCode24 = !!(flags & 0x02);
    const useData32 = !!(flags & 0x04);

    let generator: PCodeGenerator;
    try {
        generator = new PCodeGenerator(resolver.symbols, resolver, checker, diagnostics);
        generator.emitter.setUse24BitCode(useCode24);
        generator.emitter.setUseData32(useData32);
        if (options.platformSize != null) {
            generator.setPlatformSize(options.platformSize);
        }
        if (options.headerLineCount != null) {
            generator.setHeaderLineCount(options.headerLineCount);
        }
        if (options.resolveDataAddresses) {
            generator.setResolveDataAddresses(true);
            generator.emitter.setAutoTrackDataRefs(true);
        }
        if (options.projectOverrideStackSize != null) {
            generator.setProjectOverrideStackSize(options.projectOverrideStackSize);
        }
        if (options.minLocalAllocSizeBeforeTemp != null) {
            generator.setMinLocalAllocSizeBeforeTemp(options.minLocalAllocSizeBeforeTemp);
        }
        if (options.projectCalleeNamesLower != null) {
            generator.setProjectCalleeNamesLower(options.projectCalleeNamesLower);
        }
        if (options.projectGlobalAllocSize != null) {
            generator.setProjectGlobalAllocSize(options.projectGlobalAllocSize);
        }
        generator.generate(ast);
    } catch (e) {
        diagnostics.error({ file: fileName, line: 1, column: 0 }, `Code generation failed: ${e instanceof Error ? e.message : String(e)}`, 'CODEGEN');
        return { ...emptyResult, ast, errors: diagnostics.getErrors(), warnings: diagnostics.getWarnings() };
    }

    const maxEventNumber = options.maxEventNumber ?? resolver.getMaxEventNumber();

    let obj: Buffer;
    try {
        const tobjWriter = new TObjWriter();
        tobjWriter.setFlags(flags);
        obj = tobjWriter.write(generator.emitter, resolver.symbols, fileName, maxEventNumber, {
            includedFiles: options.includedFiles,
            platformSize: options.platformSize,
            fileSequence: options.fileSequence,
            sourceFilePath: options.sourceFilePath,
            firmwareVer: options.firmwareVer,
            headerLineCount: options.headerLineCount,
            globalAllocSize: generator.getGlobalAllocSize(),
            localAllocSize: generator.getLocalAllocSize(),
            stackSize: generator.getStackSize(),
            fileData: options.fileData,
            resourceEntries: options.resourceEntries,
            sourceMap: options.sourceMap,
            projectName: options.projectName,
            buildId: options.buildId,
            configStr: options.configStr,
        });
    } catch (e) {
        diagnostics.error({ file: fileName, line: 1, column: 0 }, `Object file generation failed: ${e instanceof Error ? e.message : String(e)}`, 'TOBJ');
        return { ...emptyResult, ast, errors: diagnostics.getErrors(), warnings: diagnostics.getWarnings() };
    }

    return {
        obj,
        ast,
        errors: diagnostics.getErrors(),
        warnings: diagnostics.getWarnings(),
        globalAllocSize: generator.getGlobalAllocSize(),
        localAllocSize: generator.getLocalAllocSize(),
        stackSize: generator.getStackSize(),
        localAllocSizeBeforeCalledFuncs: generator.getLocalAllocSizeBeforeCalledFuncs(),
        initObjDescriptors: generator.emitter.getInitObjDescriptors(),
    };
}

export function link(objFiles: { name: string; data: Buffer; initObjDescriptors?: InitObjDescriptor[] }[], options: LinkOptions = {}, linkerOptions: LinkerOptions = {}): LinkResult {
    const diagnostics = new DiagnosticCollection();
    try {
        const linker = new Linker(diagnostics, linkerOptions);
        const tpc = linker.link(objFiles);
        return {
            tpc,
            errors: diagnostics.getErrors(),
            warnings: diagnostics.getWarnings(),
        };
    } catch (e) {
        diagnostics.error({ file: '<linker>', line: 0, column: 0 }, `Linking failed: ${e instanceof Error ? e.message : String(e)}`, 'LINK');
        return {
            tpc: Buffer.alloc(0),
            errors: diagnostics.getErrors(),
            warnings: diagnostics.getWarnings(),
        };
    }
}

// Re-exports
export { Program } from './ast/nodes';
export { Diagnostic, DiagnosticSeverity } from './errors';
export { ASTBuilder } from './ast/builder';
export { SemanticResolver } from './semantics/resolver';
export { TypeChecker } from './semantics/checker';
export { PCodeGenerator } from './codegen/generator';
export { TObjWriter } from './tobj/writer';
export { Linker, LinkerOptions } from './linker/linker';
