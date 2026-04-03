import * as AST from '../ast/nodes';
import * as OP from './opcodes';
import { ByteEmitter } from './emitter';
import { DiagnosticCollection } from '../errors';
import { SymbolTable, SymbolKind, VariableSymbol, FunctionSymbol, SyscallSymbol, ObjectSymbol, PropertySymbol, ConstantSymbol } from '../semantics/symbols';
import { SemanticResolver } from '../semantics/resolver';
import { TypeChecker } from '../semantics/checker';
import {
    DataType, isString, isFloat, isNumeric, isEnum, isStruct, isArray, isIntegral, isPrimitive,
    StringDataType, EnumDataType, StructDataType, ArrayDataType, getPromotedType, BUILTIN_TYPES,
} from '../semantics/types';
import {
    BINARY_OPS,
    CMP_OPS,
    CMP_OPS_SIGNED,
    CMP_OPS_UNSIGNED,
    UNARY_OPS,
    getLoadOpcode,
    getStoreOpcode,
    getCmpOpInfo,
    needsSyscall,
    getSyscallName,
    relationalComparisonSigned,
} from './operators';
import { TObjRttiType } from '../tobj/format';

interface GeneratorContext {
    currentFunction?: FunctionSymbol;
    loopStartLabel?: string;
    loopEndLabel?: string;
    functionEndLabel?: string;
    labelCounter: number;
}

const INTERNAL_SYSCALL_MAP: Record<string, string> = {
    '__add32': 'ladd', '__sub32': 'lsub', '__mul32': 'lmul',
    '__div32': 'ldiv', '__divi32': 'ldivi', '__mod32': 'lmod', '__modi32': 'lmodi',
    '__and32': 'land', '__or32': 'lor', '__xor32': 'lxor', '__not32': 'lnot',
    '__neg32': 'lneg', '__shl32': 'lshl', '__shr32': 'lshr',
    '__fadd': 'fadd', '__fsub': 'fsub', '__fmul': 'fmul', '__fdiv': 'fdiv', '__fneg': 'fneg',
    '__fcmp': 'fcmp', '__lcmp': 'lcmp',
};

export class PCodeGenerator {
    private static readonly TEMP_STRING_SLOT_SIZE = 257;
    private static readonly TEMP_SCALAR_SLOT_SIZE = 4;
    readonly emitter = new ByteEmitter();
    private symbols: SymbolTable;
    private resolver: SemanticResolver;
    private checker: TypeChecker;
    private diagnostics: DiagnosticCollection;
    private ctx: GeneratorContext = { labelCounter: 0 };
    private syscallMap = new Map<string, number>();
    private globalDataOffset = 0;
    private localAllocSize = 0;
    private platformSize = 0;
    private stackSize = 0;
    private resolveDataAddresses = false;
    private headerLineCount = 0;
    private tempScratchBase = 0;
    private localVarLabelMap = new Map<VariableSymbol, string>();
    private callGraph = new Map<string, Set<string>>();
    private functionTempBase = new Map<string, number>();
    private liveReachable = new Set<string>();
    private preEvalMap = new Map<AST.CallExpr, number>();
    private functionReturnPtrAddr = new Map<string, number>();
    /** Bytes the root-function temp scratch area extends past tempScratchBase. */
    private rootTempScratchSize = 0;
    /** For on_* only: localBase + this = string/scalar scratch (params + dim locals processed so far in codegen order). */
    private onEventDeclaredLocalBytes = 0;
    /** For on_* only: sum of word-rounded local/param sizes (tmake stack slots); drives property-getter numeric scratch base. */
    private onEventStackSlotBytes = 0;
    private functionTempSlotSizes = new Map<string, number>();
    private pendingReturnTarget: number | undefined;
    private isStatementCall = false;
    private projectOverrideStackSize?: number;
    private minLocalAllocSizeBeforeTemp?: number;
    /** If set, `minLocalAllocSizeBeforeTemp` applies only to these roots (plus single-file default: all). */
    private projectCalleeNamesLower?: Set<string>;
    private _localAllocSizeBeforeCalledFuncs = 0;
    private projectGlobalAllocSize = 0;

    constructor(symbols: SymbolTable, resolver: SemanticResolver, checker: TypeChecker, diagnostics: DiagnosticCollection) {
        this.symbols = symbols;
        this.resolver = resolver;
        this.checker = checker;
        this.diagnostics = diagnostics;
    }

    setPlatformSize(size: number): void {
        this.platformSize = size;
    }

    setResolveDataAddresses(resolve: boolean): void {
        this.resolveDataAddresses = resolve;
    }

    setHeaderLineCount(count: number): void {
        this.headerLineCount = count;
    }

    getGlobalAllocSize(): number {
        return this.globalDataOffset;
    }

    getLocalAllocSize(): number {
        return this.localAllocSize;
    }

    getStackSize(): number {
        return this.stackSize;
    }

    getLocalAllocSizeBeforeCalledFuncs(): number {
        return this._localAllocSizeBeforeCalledFuncs;
    }

    setProjectOverrideStackSize(size: number): void {
        this.projectOverrideStackSize = size;
    }

    setMinLocalAllocSizeBeforeTemp(size: number): void {
        this.minLocalAllocSizeBeforeTemp = size;
    }

    setProjectCalleeNamesLower(names: Set<string>): void {
        this.projectCalleeNamesLower = names;
    }

    setProjectGlobalAllocSize(size: number): void {
        this.projectGlobalAllocSize = size;
    }

    /** Static bytes before scratch (params + all user locals). Used for registerTempVariables / maxRootArea parity. */
    private eventFramePrefixBytes(fn: FunctionSymbol | undefined): number {
        if (!fn?.name.startsWith('on_')) return 0;
        let n = 0;
        for (const p of fn.parameters) {
            n += p.isByRef ? 4 : (p.dataType?.size ?? 2);
        }
        for (const v of fn.localVariables) {
            if (v.isTemp) continue;
            n += v.dataType?.size ?? 2;
        }
        return n;
    }

    private getFuncTempSlotSize(name: string): number {
        return this.functionTempSlotSizes.get(name.toLowerCase()) ?? PCodeGenerator.TEMP_STRING_SLOT_SIZE;
    }

    private currentTempSlotSize(): number {
        const fn = this.ctx.currentFunction;
        return fn ? this.getFuncTempSlotSize(fn.name) : PCodeGenerator.TEMP_STRING_SLOT_SIZE;
    }

    private computeAllFunctionTempSlotSizes(program: AST.Program): void {
        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            const maxLen = this.maxTempStringLenInStatements(decl.body);
            if (maxLen >= 0) {
                this.functionTempSlotSizes.set(decl.name.toLowerCase(), 2 + maxLen);
            }
        }
    }

    private maxTempStringLenInStatements(stmts: AST.Statement[]): number {
        let maxLen = -1;
        for (const stmt of stmts) {
            const len = this.maxTempStringLenInNode(stmt);
            if (len > maxLen) maxLen = len;
            if (stmt.kind === 'IfStmt') {
                const t = this.maxTempStringLenInStatements(stmt.thenBody);
                if (t > maxLen) maxLen = t;
                for (const br of stmt.elseIfBranches) {
                    const b = this.maxTempStringLenInStatements(br.body);
                    if (b > maxLen) maxLen = b;
                }
                if (stmt.elseBody) {
                    const e = this.maxTempStringLenInStatements(stmt.elseBody);
                    if (e > maxLen) maxLen = e;
                }
            } else if (stmt.kind === 'WhileStmt') {
                const w = this.maxTempStringLenInStatements(stmt.body);
                if (w > maxLen) maxLen = w;
            } else if (stmt.kind === 'ForStmt') {
                const f = this.maxTempStringLenInStatements(stmt.body);
                if (f > maxLen) maxLen = f;
            } else if (stmt.kind === 'DoLoopStmt') {
                const d = this.maxTempStringLenInStatements(stmt.body);
                if (d > maxLen) maxLen = d;
            } else if (stmt.kind === 'SelectCaseStmt') {
                for (const c of stmt.cases) {
                    const cs = this.maxTempStringLenInStatements(c.body);
                    if (cs > maxLen) maxLen = cs;
                }
                if (stmt.defaultCase) {
                    const dc = this.maxTempStringLenInStatements(stmt.defaultCase);
                    if (dc > maxLen) maxLen = dc;
                }
            }
        }
        return maxLen;
    }

    private maxTempStringLenInNode(node: unknown): number {
        if (!node || typeof node !== 'object') return -1;
        const n = node as Record<string, unknown>;
        let maxLen = -1;
        if (n.kind === 'CallExpr') {
            const len = this.maxTempStringLenForCall(n as unknown as AST.CallExpr);
            if (len > maxLen) maxLen = len;
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'kind') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    const cl = this.maxTempStringLenInNode(c);
                    if (cl > maxLen) maxLen = cl;
                }
            } else if (child && typeof child === 'object' && (child as Record<string, unknown>).kind) {
                const cl = this.maxTempStringLenInNode(child);
                if (cl > maxLen) maxLen = cl;
            }
        }
        return maxLen;
    }

    private maxTempStringLenForCall(callExpr: AST.CallExpr): number {
        let maxLen = -1;
        let params: VariableSymbol[] | undefined;

        if (callExpr.callee.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(callExpr.callee.name);
            if (sym?.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                params = sc.parameters;
                if (sc.returnType && isString(sc.returnType)) maxLen = 255;
            } else if (sym?.kind === SymbolKind.Function || sym?.kind === SymbolKind.Sub) {
                const fn = sym as FunctionSymbol;
                params = fn.parameters;
                if (fn.returnType && isString(fn.returnType)) maxLen = 255;
            }
        } else if (callExpr.callee.kind === 'MemberExpr' && callExpr.callee.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(callExpr.callee.object.name);
            if (objSym?.kind === SymbolKind.Object) {
                const fn = (objSym as ObjectSymbol).functions.get(callExpr.callee.property.toLowerCase());
                if (fn) {
                    params = fn.parameters;
                    if (fn.returnType && isString(fn.returnType)) maxLen = 255;
                }
            }
        }

        if (!params) return maxLen;

        for (let i = 0; i < callExpr.args.length && i < params.length; i++) {
            const param = params[i];
            const arg = callExpr.args[i];
            const paramDt = param.dataType;
            const isStringParam = paramDt && isString(paramDt);
            const isByRefParam = param.isByRef;

            if (isByRefParam || isStringParam) {
                if (arg.kind === 'IdentifierExpr') continue;
                if (arg.kind === 'StringLiteral') {
                    if (arg.value.length > maxLen) maxLen = arg.value.length;
                } else {
                    maxLen = 255;
                }
            }
        }

        return maxLen;
    }

    private canDirectReturnTo(callExpr: AST.CallExpr): boolean {
        if (callExpr.callee.kind !== 'IdentifierExpr') return false;
        const sym = this.symbols.current.lookup(callExpr.callee.name);
        if (!sym || sym.kind !== SymbolKind.Function) return false;
        const fn = sym as FunctionSymbol;
        return !!fn.returnType && !isString(fn.returnType) && this.functionReturnPtrAddr.has(fn.name);
    }

    private onEventScratchSkip(): number {
        const fn = this.ctx.currentFunction;
        if (!fn?.name.startsWith('on_')) return 0;
        return this.onEventDeclaredLocalBytes;
    }

    /** tmake uses word-sized stack slots for on_* locals when placing syscall getter scratch (see syscalls str(sys.byte)). */
    private onEventScalarScratchSkip(): number {
        const fn = this.ctx.currentFunction;
        if (!fn?.name.startsWith('on_')) return this.onEventScratchSkip();
        return this.onEventStackSlotBytes;
    }

    private getTempStringAddr(slot = 0): number {
        const slotSize = this.currentTempSlotSize();
        const fn = this.ctx.currentFunction;
        if (fn) {
            const fnBase = this.functionTempBase.get(fn.name);
            if (fnBase !== undefined) {
                return fnBase + slot * slotSize;
            }
        }
        const skip = this.onEventScratchSkip();
        return this.tempScratchBase + skip + slot * slotSize;
    }

    private getTempScalarAddr(slot = 0): number {
        const slotSize = this.currentTempSlotSize();
        const fn = this.ctx.currentFunction;
        if (fn) {
            const fnBase = this.functionTempBase.get(fn.name);
            if (fnBase !== undefined) {
                return fnBase + this.getFuncTempSlotSize(fn.name)
                    + slot * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
            }
        }
        const skip = this.onEventScalarScratchSkip();
        // Matches registerTempVariables: _tmp_numeric_result at tempBase + one string slot.
        return this.tempScratchBase + skip + slotSize + slot * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
    }

    private isFromCurrentFile(decl: AST.TopLevelDeclaration): boolean {
        if (this.headerLineCount <= 0) return true;
        return decl.loc.line > this.headerLineCount;
    }

    generate(program: AST.Program): void {
        this.buildSyscallMap();
        this.allocateGlobalVariables(program);
        this.buildCallGraph(program);
        this.computeAllFunctionTempSlotSizes(program);
        this.stackSize = this.projectOverrideStackSize ?? this.computeStackSize();
        this.pruneUnreferencedLocals(program);
        this.allocateFunctionFrames(program);

        const localBase = this.platformSize + Math.max(this.globalDataOffset, this.projectGlobalAllocSize) + this.stackSize;
        this.includeTempsInLocalAllocSize(program);
        if (this.minLocalAllocSizeBeforeTemp !== undefined) {
            this.localAllocSize = Math.max(this.localAllocSize, this.minLocalAllocSizeBeforeTemp);
        }
        this.tempScratchBase = localBase + this.localAllocSize;
        this.localAllocSize += this.rootTempScratchSize;

        const maxRootArea = this.computeMaxRootArea(program);
        this._localAllocSizeBeforeCalledFuncs = Math.max(this.localAllocSize, maxRootArea);
        this.allocateCalledFunctionParams(program, maxRootArea);

        this.registerTempVariables(program);
        this.assignLocalVarLabels(program);

        // Match tmake RData layout: pool every string literal from the full parsed unit
        // (platform header + source) in source order before codegen. Otherwise literals
        // used only in skipped header bodies never get slots and later strings sit too low.
        this.preallocateStringPoolFromAst(program);

        this.emitter.beginInit();
        this.generateGlobalInit(program);
        this.emitter.endInit();

        if (this.emitter.initSize === 0) {
            const hasEventImpl = program.declarations.some(
                d => this.isFromCurrentFile(d)
                    && (d.kind === 'SubDecl' || d.kind === 'FunctionDecl')
                    && d.name.startsWith('on_'),
            );
            if (hasEventImpl) {
                this.emitUnimplementedEventStub();
            }
        }

        for (const decl of program.declarations) {
            if (!this.isFromCurrentFile(decl)) continue;
            switch (decl.kind) {
                case 'SubDecl': this.generateSub(decl); break;
                case 'FunctionDecl': this.generateFunction(decl); break;
            }
        }

        this.emitter.resolveLabels();
    }

    private emitUnimplementedEventStub(): void {
        const hasUnimplementedEvent = this.symbols.globalScope.getAllSymbols().some(
            s => s.kind === SymbolKind.Event
        );
        if (hasUnimplementedEvent) {
            this.emitter.emitByte(OP.OPCODE_RET);
        }
    }

    /**
     * Tibbo pools string literals from the entire expanded translation unit (headers + file)
     * in source order. We only emit bytecode for decls after headerLineCount, so without this
     * pass RData omits header-only literals and every later string sits at the wrong offset.
     */
    private preallocateStringPoolFromAst(program: AST.Program): void {
        const hits: { s: string; line: number; col: number }[] = [];
        const skipLiterals = new Set<AST.StringLiteral>();
        for (const decl of program.declarations) {
            this.collectFoldedStringLiterals(decl, skipLiterals);
        }

        const visit = (node: unknown): void => {
            if (node === null || node === undefined) return;
            if (typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            if (n.kind === 'BinaryExpr') {
                const expr = n as unknown as AST.BinaryExpr;
                if (expr.op === AST.BinaryOp.Add) {
                    const folded = this.tryFoldStringConcat(expr);
                    if (folded !== null) {
                        hits.push({
                            s: folded,
                            line: expr.loc?.line ?? 0,
                            col: expr.loc?.column ?? 0,
                        });
                        return;
                    }
                }
            }
            if (n.kind === 'CallExpr') {
                const call = n as unknown as AST.CallExpr;
                const foldedChr = this.tryFoldChrCall(call);
                if (foldedChr !== null) {
                    hits.push({
                        s: foldedChr,
                        line: call.loc?.line ?? 0,
                        col: call.loc?.column ?? 0,
                    });
                }
            }
            if (n.kind === 'StringLiteral') {
                const sl = n as unknown as AST.StringLiteral;
                if (!skipLiterals.has(sl)) {
                    hits.push({
                        s: sl.value,
                        line: sl.loc?.line ?? 0,
                        col: sl.loc?.column ?? 0,
                    });
                }
            }
            for (const key of Object.keys(n)) {
                if (key === 'loc') continue;
                const v = n[key];
                if (Array.isArray(v)) {
                    for (const item of v) visit(item);
                } else if (v && typeof v === 'object') {
                    visit(v);
                }
            }
        };

        for (const decl of program.declarations) {
            visit(decl);
        }

        hits.sort((a, b) => a.line - b.line || a.col - b.col);
        for (const h of hits) {
            this.emitter.addStringRData(h.s);
        }
    }

    private static readonly SMALL_INTEGRAL_TYPES = new Set([
        AST.BaseTypeKind.Byte, AST.BaseTypeKind.Char, AST.BaseTypeKind.Boolean,
        AST.BaseTypeKind.Word, AST.BaseTypeKind.Short, AST.BaseTypeKind.Integer,
    ]);

    /**
     * tmake constant-folds decimal string literals assigned to integral types smaller
     * than 32 bits, so those literals never enter RData.  Mark them so the pre-pool
     * visitor can skip them.
     */
    private collectFoldedStringLiterals(node: unknown, out: Set<AST.StringLiteral>): void {
        if (node === null || node === undefined || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.kind === 'DimStmt') {
            const dim = n as unknown as AST.DimStmt;
            if (dim.initializer?.kind === 'StringLiteral' && dim.typeRef) {
                const tn = dim.typeRef.typeName;
                if (tn.kind === 'BaseType' && PCodeGenerator.SMALL_INTEGRAL_TYPES.has(tn.baseType)) {
                    const num = parseInt((dim.initializer as AST.StringLiteral).value, 10);
                    if (!isNaN(num)) {
                        out.add(dim.initializer as AST.StringLiteral);
                    }
                }
            }
        } else if (n.kind === 'ExpressionStmt') {
            const es = n as unknown as AST.ExpressionStmt;
            if (es.expression.kind === 'BinaryExpr') {
                const bin = es.expression as AST.BinaryExpr;
                if (bin.op === AST.BinaryOp.Eq && bin.right.kind === 'StringLiteral') {
                    const num = parseInt((bin.right as AST.StringLiteral).value, 10);
                    if (!isNaN(num)) {
                        out.add(bin.right as AST.StringLiteral);
                    }
                }
            }
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc') continue;
            const v = n[key];
            if (Array.isArray(v)) {
                for (const item of v) this.collectFoldedStringLiterals(item, out);
            } else if (v && typeof v === 'object') {
                this.collectFoldedStringLiterals(v, out);
            }
        }
    }

    private makeLabel(prefix: string): string {
        return `${prefix}_${this.ctx.labelCounter++}`;
    }

    // ─── Syscall map ────────────────────────────────────────────────────────

    private buildSyscallMap(): void {
        for (const sym of this.symbols.globalScope.getAllSymbols()) {
            if (sym.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                this.syscallMap.set(sc.name.toLowerCase(), sc.syscallNumber);
            }
            if (sym.kind === SymbolKind.Object) {
                const obj = sym as ObjectSymbol;
                for (const [, fn] of obj.functions) {
                    const key = fn.name.toLowerCase();
                    if (!this.syscallMap.has(key)) {
                        this.syscallMap.set(key, fn.syscallNumber);
                    }
                }
            }
        }
    }

    private lookupSyscallNumber(name: string): number {
        const key = name.toLowerCase();
        const direct = this.syscallMap.get(key);
        if (direct !== undefined) return direct;

        const internalName = INTERNAL_SYSCALL_MAP[key];
        if (internalName) {
            const n = this.syscallMap.get(internalName.toLowerCase());
            if (n !== undefined) return n;
        }

        const withBang = this.syscallMap.get('!' + key);
        if (withBang !== undefined) return withBang;

        const noBang = key.startsWith('!') ? this.syscallMap.get(key.substring(1)) : undefined;
        if (noBang !== undefined) return noBang;

        return -1;
    }

    private emitSyscall(num: number): void {
        if (num <= 255) {
            this.emitter.emitByte(OP.OPCODE_SYSCALL);
            this.emitter.emitByte(num);
        } else {
            this.emitter.emitByte(OP.OPCODE_SYSCALL2);
            this.emitter.emitWord(num);
        }
    }

    private emitSyscallByName(name: string): void {
        const num = this.lookupSyscallNumber(name);
        if (num < 0) {
            this.diagnostics.warning({ file: '', line: 0, column: 0 }, `Unknown syscall: ${name}`);
            this.emitter.emitByte(OP.OPCODE_SYSCALL);
            this.emitter.emitByte(0);
            return;
        }
        this.emitSyscall(num);
    }

    // ─── Syscall argument helpers ───────────────────────────────────────────

    private emitSyscallArg(argIndex: number): void {
        const addr = argIndex * 4;
        if (this.emitter.isData32) {
            this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
            this.emitter.emitDword(addr);
        } else {
            this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
            this.emitter.emitWord(addr);
        }
    }

    private emitLeaToArg(addr: number, argIndex: number, isByRef = false): void {
        this.emitter.emitByte(isByRef ? OP.OPCODE_LOA32 : OP.OPCODE_LEA);
        this.emitter.emitDataAddress(addr);
        this.emitSyscallArg(argIndex);
    }

    private emitLeaArg(dataAddr: number): void {
        this.emitLeaToArg(dataAddr, 0);
    }

    private emitRDataLoad(rdataOffset: number): void {
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
        this.emitter.recordRDataRef(rdataOffset);
        this.emitter.emitDword(rdataOffset);
    }

    private checkNotDeclareOnly(sym: VariableSymbol, loc: { file: string; line: number; column: number }): void {
        if (sym.isDeclare) {
            this.diagnostics.error(loc, `'${sym.name}' is declared but not defined`);
        }
    }

    private emitVarDataAddress(sym: VariableSymbol): void {
        if (sym.isGlobal) {
            this.emitter.emitDataAddressRef(`?V:${sym.name}`);
        } else {
            const labelName = this.localVarLabelMap.get(sym);
            if (labelName) {
                this.emitter.emitDataAddressRef(labelName);
            } else {
                this.emitter.emitDataAddress(sym.address ?? 0);
            }
        }
    }

    private emitVarDataAddressWithOffset(sym: VariableSymbol, byteOffset: number): void {
        if (byteOffset === 0) {
            this.emitVarDataAddress(sym);
            return;
        }
        if (sym.isGlobal) {
            this.emitter.emitDataAddressRefOffset(`?V:${sym.name}`, byteOffset);
        } else {
            const labelName = this.localVarLabelMap.get(sym);
            if (labelName) {
                this.emitter.emitDataAddressRefOffset(labelName, byteOffset);
            } else {
                this.emitter.emitDataAddress((sym.address ?? 0) + byteOffset);
            }
        }
    }

    private emitVarLeaArg(sym: VariableSymbol): void {
        this.emitVarLeaArgAt(sym, 0);
    }

    private emitVarLeaArgAt(sym: VariableSymbol, argIndex: number): void {
        const labelName = sym.isGlobal ? `?V:${sym.name}` : this.localVarLabelMap.get(sym);
        if (labelName) {
            this.emitter.emitByte(sym.isByRef ? OP.OPCODE_LOA32 : OP.OPCODE_LEA);
            this.emitter.emitDataAddressRef(labelName);
            this.emitSyscallArg(argIndex);
        } else {
            this.emitLeaToArg(sym.address ?? 0, argIndex, sym.isByRef);
        }
    }

    private getSyscallParamStoreSize(param: VariableSymbol): number {
        if (param.isByRef || (param.dataType && isString(param.dataType))) return 4;
        return param.dataType?.size ?? 2;
    }

    private emitStoreToArgBuffer(offset: number, storeSize: number): void {
        let op: number;
        if (storeSize >= 4) op = OP.OPCODE_STO32;
        else if (storeSize === 1) op = OP.OPCODE_STO8;
        else op = OP.OPCODE_STO16;
        this.emitter.emitByte(op | OP.OPCODE_DIRECT);
        this.emitter.emitDword(offset);
    }

    private emitLeaToArgOffset(addr: number, offset: number, isByRef = false): void {
        this.emitter.emitByte(isByRef ? OP.OPCODE_LOA32 : OP.OPCODE_LEA);
        this.emitter.emitDataAddress(addr);
        this.emitStoreToArgBuffer(offset, 4);
    }

    private emitVarLeaToArgOffset(sym: VariableSymbol, offset: number): void {
        const labelName = sym.isGlobal ? `?V:${sym.name}` : this.localVarLabelMap.get(sym);
        if (labelName) {
            this.emitter.emitByte(sym.isByRef ? OP.OPCODE_LOA32 : OP.OPCODE_LEA);
            this.emitter.emitDataAddressRef(labelName);
            this.emitStoreToArgBuffer(offset, 4);
        } else {
            this.emitLeaToArgOffset(sym.address ?? 0, offset, sym.isByRef);
        }
    }

    private emitTempStringInit(addr: number, maxLen = 255): void {
        this.generateIntLiteral(maxLen << 8);
        this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
        this.emitter.emitDataAddress(addr);
    }

    private elementRttiType(et: DataType): number {
        if (isString(et)) return TObjRttiType.String;
        if (isArray(et))  return TObjRttiType.Array;
        if (isStruct(et)) return TObjRttiType.Struct;
        // primitive: classify by size
        if (et.size >= 4) return TObjRttiType.Dword;
        if (et.size >= 2) return TObjRttiType.Word;
        return TObjRttiType.Byte;
    }

    private buildTypeDescriptor(dt: DataType | undefined): number[] | null {
        if (!dt) return null;
        if (isArray(dt)) {
            const a = dt as ArrayDataType;
            const et = a.elementType;
            const etTag = this.elementRttiType(et);
            // info byte: for strings = maxLength; otherwise 0
            const etInfo = isString(et) ? (et as StringDataType).maxLength : 0;
            return [
                TObjRttiType.Array,          // [0] array type tag
                a.dimensions[0] & 0xFF,      // [1] element count lo
                (a.dimensions[0] >> 8) & 0xFF, // [2] element count hi
                dt.size & 0xFF,              // [3] total size lo
                (dt.size >> 8) & 0xFF,       // [4] total size hi
                etTag,                       // [5] element type tag
                etInfo & 0xFF,               // [6] element info (maxLength for string)
                0x00,                        // [7] reserved
                et.size & 0xFF,              // [8] element size lo
                (et.size >> 8) & 0xFF,       // [9] element size hi
            ];
        }
        return null;
    }

    private emitInitObjAtAddr(addr: number, isByRef = false, dt?: DataType): void {
        const indirection = isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        this.emitter.emitByte(OP.OPCODE_LEA | indirection);
        this.emitter.emitDataAddress(addr);
        this.emitSyscallArg(0);
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
        const desc = this.buildTypeDescriptor(dt);
        if (desc) {
            this.emitter.addInitObjDescriptor(desc);
        }
        this.emitter.emitDword(0);
        this.emitSyscallArg(1);
        this.emitSyscallByName('initobj');
    }

    private emitInitObj(sym: VariableSymbol): void {
        if (sym.isGlobal) {
            this.emitVarLeaArg(sym);
        } else {
            this.emitInitObjAtAddr(sym.address ?? 0, sym.isByRef, sym.dataType);
            return;
        }
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
        const desc = this.buildTypeDescriptor(sym.dataType);
        if (desc) {
            this.emitter.addInitObjDescriptor(desc);
        }
        this.emitter.emitDword(0);
        this.emitSyscallArg(1);
        this.emitSyscallByName('initobj');
    }

    private flattenArrayLiteral(node: AST.ArrayLiteralNode): AST.Expression[] {
        const result: AST.Expression[] = [];
        for (const element of node.elements) {
            if ((element as AST.ArrayLiteralNode).kind === 'ArrayLiteral') {
                result.push(...this.flattenArrayLiteral(element as AST.ArrayLiteralNode));
            } else {
                result.push(element as AST.Expression);
            }
        }
        return result;
    }

    private emitArrayInitializer(addr: number, dt: DataType, init: AST.ArrayLiteralNode, isByRef = false): void {
        if (!isArray(dt)) return;
        const elementType = dt.elementType;
        const step = elementType.size;
        const indirection = isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        const values = this.flattenArrayLiteral(init);

        for (let i = 0; i < values.length; i++) {
            const elementAddr = addr + i * step;
            const value = values[i];

            if (isString(elementType)) {
                this.generateStringAssignmentToAddr(elementAddr, isByRef, value);
                continue;
            }

            if (isArray(elementType) || isStruct(elementType)) {
                continue;
            }

            this.generateExpression(value);
            const storeOp = getStoreOpcode(elementType);
            this.emitter.emitByte(storeOp | indirection);
            this.emitter.emitDataAddress(elementAddr);
        }
    }

    private emitSyscallWithArgs(_syscallName: string, sym: SyscallSymbol, args: AST.Expression[]): void {
        const nextOffset = this.emitSyscallArgsOnly(sym, args, 0);
        if (sym.returnType && isString(sym.returnType)) {
            const tempAddr = this.getTempStringAddr(0);
            this.emitTempStringInit(tempAddr);
            this.emitLeaToArgOffset(tempAddr, nextOffset);
        }
        this.emitSyscall(sym.syscallNumber);
    }

    private emitSyscallArgsOnly(
        sym: SyscallSymbol,
        args: AST.Expression[],
        startOffset: number,
        strOutputStringAddr?: number,
    ): number {
        const params = sym.parameters;
        let offset = startOffset;
        for (let i = 0; i < args.length && i < params.length; i++) {
            const param = params[i];
            const argExpr = args[i];
            const paramDt = param.dataType;
            const storeSize = this.getSyscallParamStoreSize(param);

            if (param.isByRef || (paramDt && isString(paramDt))) {
                if (argExpr.kind === 'IdentifierExpr') {
                    const argSym = this.symbols.current.lookup(argExpr.name);
                    if (argSym && (argSym.kind === SymbolKind.Variable || argSym.kind === SymbolKind.Parameter)) {
                        const varSym = argSym as VariableSymbol;
                        if (varSym.isByRef) {
                            this.emitter.emitByte(OP.OPCODE_LOA32);
                        } else {
                            this.emitter.emitByte(OP.OPCODE_LEA);
                        }
                        this.emitVarDataAddress(varSym);
                        this.emitStoreToArgBuffer(offset, 4);
                        offset += storeSize;
                        continue;
                    }
                }
                if (paramDt && isString(paramDt) && argExpr.kind === 'StringLiteral') {
                    const tempAddr = this.getTempStringAddr(0);
                    this.emitTempStringInit(tempAddr, argExpr.value.length);
                    this.emitter.emitByte(OP.OPCODE_LEA | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(tempAddr);
                    this.emitSyscallArg(0);
                    const rdataOff = this.emitter.addStringRData(argExpr.value);
                    this.emitRDataLoad(rdataOff);
                    this.emitSyscallArg(1);
                    this.emitSyscallByName('strload');
                    this.emitLeaToArgOffset(tempAddr, offset);
                    offset += storeSize;
                    continue;
                }
                if (paramDt && isString(paramDt) && this.isStringExpression(argExpr)) {
                    this.emitStringExprToArg(argExpr, offset);
                    offset += storeSize;
                    continue;
                }
                if (argExpr.kind === 'MemberExpr') {
                    if (paramDt && isString(paramDt) && this.tryEmitPropertyGetterDirect(argExpr, this.getTempStringAddr(0))) {
                        this.emitLeaToArgOffset(this.getTempStringAddr(0), offset);
                        offset += storeSize;
                        continue;
                    }
                    this.emitter.emitByte(OP.OPCODE_LEA);
                    this.emitter.emitDataAddress(this.getTempScalarAddr(0));
                    this.emitStoreToArgBuffer(offset, 4);
                    this.generateMember(argExpr);
                    offset += storeSize;
                    continue;
                }
                this.generateExpression(argExpr);
                this.emitStoreToArgBuffer(offset, 4);
                offset += storeSize;
            } else {
                const maxOpSz = this.maxIntegralOperandSizeForStrArg(argExpr);
                const strByteExpandForStr =
                    this.emitter.isData32 &&
                    sym.name.toLowerCase() === 'str' &&
                    storeSize === 2 &&
                    paramDt &&
                    isIntegral(paramDt) &&
                    paramDt.size === 2 &&
                    maxOpSz !== undefined &&
                    maxOpSz < 2 &&
                    !this.strSyscallArgNeedsDwordScratchTemp(argExpr, paramDt) &&
                    (argExpr.kind === 'BinaryExpr' || this.isObjectPropertyMemberForStrByteExpand(argExpr));
                const emitStrByteScratch = (): void => {
                    const strBase = strOutputStringAddr ?? this.getTempStringAddr(0);
                    const scratch = strBase + PCodeGenerator.TEMP_STRING_SLOT_SIZE;
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(scratch);
                    this.emitter.emitByte(OP.OPCODE_LOA16I | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(scratch);
                };
                // tmake: str(val(stringVar)) passes val's byref string arg via embedded slot 1 (STO32 +4), then LOA16I widen.
                if (
                    sym.name.toLowerCase() === 'str' &&
                    argExpr.kind === 'CallExpr' &&
                    argExpr.callee.kind === 'IdentifierExpr'
                ) {
                    const calleeSym = this.symbols.current.lookup(argExpr.callee.name);
                    if (
                        calleeSym?.kind === SymbolKind.Syscall &&
                        (calleeSym as SyscallSymbol).name.toLowerCase() === 'val' &&
                        argExpr.args.length >= 1
                    ) {
                        const valSc = calleeSym as SyscallSymbol;
                        const srcArg = argExpr.args[0];
                        if (srcArg.kind === 'IdentifierExpr') {
                            const idArg = srcArg as AST.IdentifierExpr;
                            const nameLower = idArg.name.toLowerCase();
                            const curFn = this.ctx.currentFunction;
                            // Prefer the VariableSymbol from the current function frame: symbols.current.lookup
                            // must match the same object identity as localVarLabelMap keys from assignLocalVarLabels.
                            let vSym: VariableSymbol | undefined = curFn?.localVariables.find(
                                v => v.name.toLowerCase() === nameLower,
                            ) as VariableSymbol | undefined;
                            if (!vSym) {
                                vSym = curFn?.parameters.find(
                                    p => p.name.toLowerCase() === nameLower,
                                ) as VariableSymbol | undefined;
                            }
                            if (!vSym) {
                                const vs = this.symbols.current.lookup(idArg.name);
                                if (vs && (vs.kind === SymbolKind.Variable || vs.kind === SymbolKind.Parameter)) {
                                    vSym = vs as VariableSymbol;
                                }
                            }
                            if (vSym) {
                                // tmake: str(val(var)) uses the string temp slot *before* the str() output slot for
                                // the first LEA (operand differs by exactly TEMP_STRING_SLOT_SIZE from addr).
                                const strResultAddr = strOutputStringAddr ?? this.getTempStringAddr(0);
                                const strOut = strResultAddr - PCodeGenerator.TEMP_STRING_SLOT_SIZE;
                                this.emitter.emitByte(OP.OPCODE_LEA);
                                this.emitter.emitDataAddress(strOut);
                                this.emitSyscallArg(0);
                                // tmake: val's byref string LEA is str() output temp + one string slot (not strOut+2).
                                const valStrPtr = strResultAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE;
                                this.emitter.emitByte(OP.OPCODE_LEA);
                                this.emitter.emitDataAddress(valStrPtr);
                                this.emitSyscallArg(1);
                                this.emitSyscall(valSc.syscallNumber);
                                this.emitter.emitByte(OP.OPCODE_LOA16I | OP.OPCODE_DIRECT);
                                this.emitter.emitDataAddress(valStrPtr);
                                this.emitStoreToArgBuffer(offset, storeSize);
                                offset += storeSize;
                                continue;
                            }
                        }
                    }
                }
                if (argExpr.kind === 'MemberExpr') {
                    this.generateMember(argExpr);
                    if (strByteExpandForStr) emitStrByteScratch();
                    this.emitStoreToArgBuffer(offset, storeSize);
                } else {
                    this.generateExpression(argExpr);
                    if (strByteExpandForStr) emitStrByteScratch();
                    this.emitStoreToArgBuffer(offset, storeSize);
                }
                offset += storeSize;
            }
        }
        return offset;
    }

    private tryFoldStringConcat(expr: AST.Expression): string | null {
        if (expr.kind === 'StringLiteral') return expr.value;
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            const left = this.tryFoldStringConcat(expr.left);
            const right = this.tryFoldStringConcat(expr.right);
            if (left !== null && right !== null) return left + right;
        }
        return null;
    }

    private tryFoldStrCall(expr: AST.CallExpr): string | null {
        if (expr.callee.kind !== 'IdentifierExpr') return null;
        const sym = this.symbols.current.lookup(expr.callee.name);
        if (!sym || sym.kind !== SymbolKind.Syscall) return null;
        const sc = sym as SyscallSymbol;
        if (sc.name.toLowerCase() !== 'str') return null;
        if (expr.args.length !== 1) return null;
        const arg = expr.args[0];
        if (arg.kind === 'IntegerLiteral' || arg.kind === 'HexLiteral') {
            return String((arg as AST.IntegerLiteral).value);
        }
        return null;
    }

    /** Matches tide `InlineChr`: constant `chr(n)` becomes a one-char string literal at codegen (strload path). */
    private tryFoldChrCall(expr: AST.CallExpr): string | null {
        if (expr.callee.kind !== 'IdentifierExpr') return null;
        const sym = this.symbols.current.lookup(expr.callee.name);
        if (!sym || sym.kind !== SymbolKind.Syscall) return null;
        const sc = sym as SyscallSymbol;
        if (sc.name.toLowerCase() !== 'chr') return null;
        if (expr.args.length !== 1) return null;
        const v = this.evalConstantIntExpr(expr.args[0]);
        if (v === undefined) return null;
        return String.fromCharCode(v & 0xff);
    }

    private collectComplexStrCalls(expr: AST.Expression, result: AST.CallExpr[]): void {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.collectComplexStrCalls(expr.left, result);
            this.collectComplexStrCalls(expr.right, result);
            return;
        }
        if (expr.kind !== 'CallExpr') return;
        if (this.tryFoldStrCall(expr) !== null) return;
        if (expr.callee.kind !== 'IdentifierExpr') return;
        const sym = this.symbols.current.lookup(expr.callee.name);
        if (!sym || sym.kind !== SymbolKind.Syscall) return;
        const sc = sym as SyscallSymbol;
        if (sc.name.toLowerCase() !== 'str' || expr.args.length < 1) return;
        const arg = expr.args[0];
        if (arg.kind !== 'IdentifierExpr' && arg.kind !== 'IntegerLiteral' && arg.kind !== 'HexLiteral') {
            result.push(expr);
        }
    }

    private countFunctionPreEvalScalars(decl: AST.SubDecl | AST.FunctionDecl): number {
        let maxScalars = 0;
        for (const stmt of decl.body) {
            const count = this.countPreEvalScalarsInStmt(stmt);
            if (count > maxScalars) maxScalars = count;
        }
        return maxScalars;
    }

    private countPreEvalScalarsInStmt(stmt: AST.Statement): number {
        let count = 0;
        this.walkExpressionsInNode(stmt, (expr: AST.Expression) => {
            if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
                const scalars = this.countComplexStrCallsInExpr(expr);
                if (scalars > count) count = scalars;
            }
        });
        return count;
    }

    private countComplexStrCallsInExpr(expr: AST.Expression): number {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            return this.countComplexStrCallsInExpr(expr.left) + this.countComplexStrCallsInExpr(expr.right);
        }
        if (expr.kind !== 'CallExpr') return 0;
        if (expr.callee.kind !== 'IdentifierExpr') return 0;
        const name = expr.callee.name.toLowerCase();
        if (name !== 'str') return 0;
        if (expr.args.length < 1) return 0;
        const arg = expr.args[0];
        if ((arg.kind === 'IntegerLiteral' || arg.kind === 'HexLiteral')) return 0;
        if (arg.kind === 'IdentifierExpr') return 0;
        return 1;
    }

    private walkExpressionsInNode(node: unknown, visitor: (expr: AST.Expression) => void): void {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.kind && typeof n.kind === 'string' && n.kind.endsWith('Expr')) {
            visitor(n as unknown as AST.Expression);
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'kind') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                for (const item of child) this.walkExpressionsInNode(item, visitor);
            } else if (child && typeof child === 'object') {
                this.walkExpressionsInNode(child, visitor);
            }
        }
    }

    private collectReferencedLocals(body: AST.Statement[]): Set<string> {
        const referenced = new Set<string>();
        const walk = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            if (n.kind === 'IdentifierExpr' && typeof n.name === 'string') {
                referenced.add((n.name as string).toLowerCase());
            }
            if (n.kind === 'DimStmt' && (n.initializer || n.arrayInitializer)) {
                const vars = n.variables as Array<{ name: string }>;
                if (vars) {
                    for (const v of vars) referenced.add(v.name.toLowerCase());
                }
            }
            for (const key of Object.keys(n)) {
                if (key === 'loc' || key === 'kind') continue;
                const child = n[key];
                if (Array.isArray(child)) {
                    for (const item of child) walk(item);
                } else if (child && typeof child === 'object') {
                    walk(child);
                }
            }
        };
        walk(body);
        return referenced;
    }

    private pruneUnreferencedLocals(program: AST.Program): void {
        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!sym) continue;

            const referenced = this.collectReferencedLocals(decl.body);
            const isFuncReturn = decl.kind === 'FunctionDecl';
            sym.localVariables = sym.localVariables.filter(v => {
                if (v.isTemp) return true;
                if (isFuncReturn && v.name.toLowerCase() === decl.name.toLowerCase()) return true;
                if (referenced.has(v.name.toLowerCase())) return true;
                const dt = v.dataType;
                if (dt && (isString(dt) || isArray(dt) || isStruct(dt))) return true;
                return false;
            });
        }
    }

    private emitStringCallResultToAddr(expr: AST.CallExpr, addr: number, isByRef = false): boolean {
        if (expr.callee.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.callee.name);
            if (sym && sym.kind === SymbolKind.Function) {
                const fn = sym as FunctionSymbol;
                const retVar = this.getFunctionReturnVar(fn);
                if (fn.returnType && isString(fn.returnType) && retVar?.address !== undefined) {
                    this.emitFunctionCall(fn, expr.args);
                    this.emitLeaToArgOffset(addr, 0, isByRef);
                    this.emitLeaToArgOffset(retVar.address, 4);
                    this.emitSyscallByName('strcpy');
                    return true;
                }
            }
            if (sym && sym.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                if (sc.returnType && isString(sc.returnType)) {
                    let nextOffset: number;
                    const preEvalAddr = this.preEvalMap.get(expr);
                    const widePath =
                        preEvalAddr === undefined &&
                        this.emitter.isData32 &&
                        expr.args.length > 0 &&
                        sc.parameters.length > 0 &&
                        !sc.parameters[0].isByRef;
                    const p0 = widePath ? sc.parameters[0] : undefined;
                    const pdt = p0?.dataType;
                    const useWideDwordTemp =
                        !!widePath &&
                        !!pdt &&
                        this.strSyscallArgNeedsDwordScratchTemp(expr.args[0], pdt);

                    if (useWideDwordTemp) {
                        const argStoreSz = this.getSyscallParamStoreSize(p0!);
                        this.generateExpression(expr.args[0]);
                        // tmake places this dword scratch immediately after the str() output string slot.
                        const tmp = addr + PCodeGenerator.TEMP_STRING_SLOT_SIZE;
                        this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                        this.emitter.emitDataAddress(tmp);
                        this.emitTempStringInit(addr);
                        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_DIRECT);
                        this.emitter.emitDataAddress(tmp);
                        this.emitStoreToArgBuffer(0, argStoreSz);
                        nextOffset = argStoreSz;
                    } else {
                        this.emitTempStringInit(addr);
                        if (preEvalAddr !== undefined) {
                            const storeSize = this.getSyscallParamStoreSize(sc.parameters[0]);
                            this.emitter.emitByte(OP.OPCODE_LOA32);
                            this.emitter.emitDataAddress(preEvalAddr);
                            this.emitStoreToArgBuffer(0, storeSize);
                            nextOffset = storeSize;
                        } else {
                            nextOffset = this.emitSyscallArgsOnly(sc, expr.args, 0, addr);
                        }
                    }
                    const indirection = isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                    this.emitter.emitByte(OP.OPCODE_LEA | indirection);
                    this.emitter.emitDataAddress(addr);
                    this.emitStoreToArgBuffer(nextOffset, 4);
                    this.emitSyscall(sc.syscallNumber);
                    return true;
                }
            }
        }

        if (expr.callee.kind === 'MemberExpr' && expr.callee.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(expr.callee.object.name);
            if (objSym && objSym.kind === SymbolKind.Object) {
                const obj = objSym as ObjectSymbol;
                const fn = obj.functions.get(expr.callee.property.toLowerCase());
                if (fn && fn.returnType && isString(fn.returnType)) {
                    this.emitTempStringInit(addr);
                    const nextOffset = this.emitSyscallArgsOnly(fn, expr.args, 0, addr);
                    this.emitter.emitByte(OP.OPCODE_LEA);
                    this.emitter.emitDataAddress(addr);
                    this.emitStoreToArgBuffer(nextOffset, 4);
                    this.emitSyscall(fn.syscallNumber);
                    return true;
                }
            }
        }

        return false;
    }

    private emitStringExprToArg(expr: AST.Expression, argOffset: number): void {
        const tempAddr = this.getTempStringAddr(0);
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            const complexCalls: AST.CallExpr[] = [];
            this.collectComplexStrCalls(expr, complexCalls);
            const scalarBase = tempAddr + this.currentTempSlotSize();
            for (let i = 0; i < complexCalls.length; i++) {
                const call = complexCalls[i];
                this.generateExpression(call.args[0]);
                const scalarAddr = scalarBase + i * 4;
                this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(scalarAddr);
                this.preEvalMap.set(call, scalarAddr);
            }
            this.emitStringExprToTemp(expr.left, tempAddr, true);
            this.emitStringCatToTemp(expr.right, tempAddr);
            this.preEvalMap.clear();
        } else if (expr.kind === 'StringLiteral') {
            this.emitTempStringInit(tempAddr, expr.value.length);
            this.emitter.emitByte(OP.OPCODE_LEA | OP.OPCODE_DIRECT);
            this.emitter.emitDataAddress(tempAddr);
            this.emitSyscallArg(0);
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strload');
            this.emitLeaToArgOffset(tempAddr, argOffset);
            return;
        } else if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaToArgOffset(varSym, argOffset);
                return;
            }
            if (sym && sym.kind === SymbolKind.Constant && typeof (sym as ConstantSymbol).value === 'string') {
                const constStr = (sym as ConstantSymbol).value as string;
                this.emitTempStringInit(tempAddr, constStr.length);
                this.emitter.emitByte(OP.OPCODE_LEA | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(tempAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(constStr);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                this.emitLeaToArgOffset(tempAddr, argOffset);
                return;
            }
        } else if (expr.kind === 'CallExpr') {
            const foldedChr = this.tryFoldChrCall(expr);
            if (foldedChr !== null) {
                this.emitTempStringInit(tempAddr, foldedChr.length);
                this.emitter.emitByte(OP.OPCODE_LEA | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(tempAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(foldedChr);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                this.emitLeaToArgOffset(tempAddr, argOffset);
                return;
            }
            if (this.emitStringCallResultToAddr(expr, tempAddr)) {
                this.emitLeaToArgOffset(tempAddr, argOffset);
                return;
            }
        } else if (expr.kind === 'MemberExpr' && this.tryEmitPropertyGetterDirect(expr, tempAddr)) {
            this.emitLeaToArgOffset(tempAddr, argOffset);
            return;
        }
        this.emitLeaToArgOffset(tempAddr, argOffset);
    }

    private emitStringExprToTemp(expr: AST.Expression, tempAddr: number, isFirst: boolean): void {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.emitStringExprToTemp(expr.left, tempAddr, isFirst);
            this.emitStringCatToTemp(expr.right, tempAddr);
            return;
        }

        if (expr.kind === 'CallExpr') {
            const folded = this.tryFoldStrCall(expr);
            if (folded !== null) {
                this.emitTempStringInit(tempAddr, folded.length);
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitter.emitDataAddress(tempAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(folded);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName(isFirst ? 'strload' : 'strcat');
                return;
            }
            const foldedChr = this.tryFoldChrCall(expr);
            if (foldedChr !== null) {
                this.emitTempStringInit(tempAddr, foldedChr.length);
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitter.emitDataAddress(tempAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(foldedChr);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName(isFirst ? 'strload' : 'strcat');
                return;
            }
            if (this.emitStringCallResultToAddr(expr, tempAddr)) {
                if (!isFirst) {
                    this.emitLeaToArg(tempAddr, 1);
                    this.emitSyscallByName('strcat');
                }
                return;
            }
        }

        if (isFirst && expr.kind !== 'CallExpr') {
            this.emitTempStringInit(tempAddr);
        }

        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitter.emitDataAddress(tempAddr);
        this.emitSyscallArg(0);

        if (expr.kind === 'StringLiteral') {
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(1);
            this.emitSyscallByName(isFirst ? 'strload' : 'strcat');
        } else if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaArgAt(varSym, 1);
                this.emitSyscallByName(isFirst ? 'strcpy' : 'strcat');
            }
        } else if (expr.kind === 'MemberExpr') {
            const sourceAddr = isFirst ? tempAddr : tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
            if (this.tryEmitPropertyGetterDirect(expr, sourceAddr)) {
                if (!isFirst) {
                    this.emitLeaToArg(tempAddr, 0);
                    this.emitLeaToArg(sourceAddr, 1);
                    this.emitSyscallByName('strcat');
                }
                return;
            }
            this.generateMember(expr);
            this.emitSyscallArg(1);
            this.emitSyscallByName(isFirst ? 'strcpy' : 'strcat');
        }
    }

    private emitStringCatToTemp(expr: AST.Expression, tempAddr: number): void {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.emitStringCatToTemp(expr.left, tempAddr);
            this.emitStringCatToTemp(expr.right, tempAddr);
            return;
        }

        if (expr.kind === 'CallExpr') {
            const folded = this.tryFoldStrCall(expr);
            if (folded !== null) {
                const litAddr = tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
                this.emitTempStringInit(litAddr, folded.length);
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitter.emitDataAddress(litAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(folded);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                this.emitLeaToArg(tempAddr, 0);
                this.emitLeaToArg(litAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
            const foldedChr = this.tryFoldChrCall(expr);
            if (foldedChr !== null) {
                const litAddr = tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
                this.emitTempStringInit(litAddr, foldedChr.length);
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitter.emitDataAddress(litAddr);
                this.emitSyscallArg(0);
                const rdataOff = this.emitter.addStringRData(foldedChr);
                this.emitRDataLoad(rdataOff);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                this.emitLeaToArg(tempAddr, 0);
                this.emitLeaToArg(litAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
            const callResultAddr = tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
            if (this.emitStringCallResultToAddr(expr, callResultAddr)) {
                this.emitLeaToArg(tempAddr, 0);
                this.emitLeaToArg(callResultAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
        }

        if (expr.kind === 'StringLiteral') {
            const litAddr = tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
            this.emitTempStringInit(litAddr, expr.value.length);
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddress(litAddr);
            this.emitSyscallArg(0);
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strload');
            this.emitLeaToArg(tempAddr, 0);
            this.emitLeaToArg(litAddr, 1);
            this.emitSyscallByName('strcat');
            return;
        }

        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitter.emitDataAddress(tempAddr);
        this.emitSyscallArg(0);

        if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaArgAt(varSym, 1);
                this.emitSyscallByName('strcat');
            }
        } else if (expr.kind === 'MemberExpr') {
            const sourceAddr = tempAddr + this.currentTempSlotSize() + this.preEvalMap.size * 4;
            if (this.tryEmitPropertyGetterDirect(expr, sourceAddr)) {
                this.emitLeaToArg(sourceAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
            this.generateMember(expr);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strcat');
        }
    }

    // ─── Variable allocation ────────────────────────────────────────────────

    private allocateGlobalVariables(program: AST.Program): void {
        let offset = this.globalDataOffset;
        const addrBase = this.platformSize;
        for (const decl of program.declarations) {
            if (decl.kind !== 'DimStmt' || decl.isDeclare) continue;
            if (!this.isFromCurrentFile(decl)) continue;
            for (const v of decl.variables) {
                const sym = this.symbols.lookupGlobal(v.name) as VariableSymbol | undefined;
                if (!sym) continue;
                const size = sym.dataType?.size ?? 2;
                sym.address = addrBase + offset;
                this.emitter.defineDataLabel(`?V:${v.name}`, addrBase + offset);
                offset += size;
            }
        }
        this.globalDataOffset = offset;
    }

    private buildCallGraph(program: AST.Program): void {
        this.callGraph.clear();
        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            const calls = new Set<string>();
            this.collectCalls(decl.body, calls);
            this.callGraph.set(decl.name, calls);
        }
    }

    private collectCalls(stmts: AST.Statement[], calls: Set<string>): void {
        for (const stmt of stmts) {
            this.collectCallsInNode(stmt, calls);
        }
    }

    private collectCallsInNode(node: unknown, calls: Set<string>): void {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.kind === 'CallExpr') {
            const callee = n.callee as Record<string, unknown> | undefined;
            if (callee?.kind === 'IdentifierExpr') {
                const name = callee.name as string;
                const sym = this.symbols.current.lookup(name);
                if (sym && (sym.kind === SymbolKind.Function || sym.kind === SymbolKind.Sub)) {
                    calls.add(name);
                }
            }
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'kind') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                for (const c of child) this.collectCallsInNode(c, calls);
            } else if (child && typeof child === 'object' && (child as Record<string, unknown>).kind) {
                this.collectCallsInNode(child, calls);
            }
        }
    }

    private computeStackSize(): number {
        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        let maxDepth = 0;
        const visited = new Set<string>();
        const getDepth = (name: string): number => {
            if (visited.has(name)) return 0;
            visited.add(name);
            const calls = this.callGraph.get(name);
            if (!calls || calls.size === 0) return 0;
            let max = 0;
            for (const c of calls) {
                const d = 1 + getDepth(c);
                if (d > max) max = d;
            }
            visited.delete(name);
            return max;
        };

        for (const name of this.callGraph.keys()) {
            if (!name.startsWith('on_')) continue;
            const d = getDepth(name);
            if (d > maxDepth) maxDepth = d;
        }

        return maxDepth * this.emitter.addressSize;
    }

    private allocateFunctionFrames(program: AST.Program): void {
        const localBase = this.platformSize + Math.max(this.globalDataOffset, this.projectGlobalAllocSize) + this.stackSize;

        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        const computeLive = (name: string) => {
            const calls = this.callGraph.get(name);
            if (!calls) return;
            for (const c of calls) {
                if (!this.liveReachable.has(c)) {
                    this.liveReachable.add(c);
                    computeLive(c);
                }
            }
        };
        for (const name of this.callGraph.keys()) {
            if (!calledFunctions.has(name)) {
                computeLive(name);
            }
        }

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            if (calledFunctions.has(decl.name)) continue;
            const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!sym) continue;

            // Non-event root functions may be called from another module; use the
            // project-wide called-function base offset so addresses match across modules.
            const isOnEvent = decl.name.startsWith('on_');
            const scratch = this.minLocalAllocSizeBeforeTemp ?? 0;
            const invokedFromProject =
                this.projectCalleeNamesLower === undefined
                    ? true
                    : this.projectCalleeNamesLower.has(decl.name.toLowerCase());
            const rootBase = isOnEvent ? localBase : localBase + (scratch > 0 && invokedFromProject ? scratch : 0);

            let offset = 0;
            let ordinal = 1;
            for (let pi = 0; pi < sym.parameters.length; pi++) {
                const v = sym.parameters[pi];
                v.address = rootBase + offset;
                const labelName = `?A:${sym.name}:${pi}`;
                this.localVarLabelMap.set(v, labelName);
                this.emitter.defineDataLabel(labelName, v.address);
                ordinal++;
                offset += v.isByRef ? 4 : (v.dataType?.size ?? 2);
            }

            if (!isOnEvent) {
                this.allocateDeadChainInRootArea(decl.name, rootBase, offset);
            }

            const isFuncWithReturn = decl.kind === 'FunctionDecl' && !isOnEvent && !!sym.returnType;
            if (isFuncWithReturn) {
                const retPtrAddr = rootBase + offset;
                this.functionReturnPtrAddr.set(decl.name, retPtrAddr);
                const retVar = sym.localVariables.find(v => v.name.toLowerCase() === sym.name.toLowerCase());
                if (retVar) {
                    retVar.address = retPtrAddr;
                    retVar.isByRef = true;
                }
                offset += 4;
            }

            for (const v of sym.localVariables) {
                if (isFuncWithReturn && v.name.toLowerCase() === sym.name.toLowerCase()) continue;
                v.address = rootBase + offset;
                offset += v.dataType?.size ?? 2;
            }
            sym.localAllocSize = offset;
            if (!isOnEvent && offset > this.localAllocSize && this.liveReachable.has(decl.name)) {
                this.localAllocSize = offset;
            }
        }
    }

    private allocateDeadChainInRootArea(
        rootName: string,
        localBase: number,
        startOffset: number,
    ): void {
        const visited = new Set<string>([rootName]);
        const queue: { name: string; offset: number }[] = [];

        const calls = this.callGraph.get(rootName);
        if (!calls) return;

        for (const c of calls) {
            if (!this.liveReachable.has(c)) {
                queue.push({ name: c, offset: startOffset });
            }
        }

        while (queue.length > 0) {
            const { name, offset } = queue.shift()!;
            if (visited.has(name)) continue;
            visited.add(name);

            const sym = this.symbols.lookupGlobal(name) as FunctionSymbol | undefined;
            if (!sym) continue;

            let paramEnd = offset;
            for (let i = 0; i < sym.parameters.length; i++) {
                const v = sym.parameters[i];
                v.address = localBase + paramEnd;
                const labelName = `?A:${sym.name}:${i}`;
                this.localVarLabelMap.set(v, labelName);
                this.emitter.defineDataLabel(labelName, v.address);
                paramEnd += v.isByRef ? 4 : (v.dataType?.size ?? 2);
            }

            const nextCalls = this.callGraph.get(name);
            if (nextCalls) {
                for (const c of nextCalls) {
                    if (!this.liveReachable.has(c)) {
                        queue.push({ name: c, offset: paramEnd });
                    }
                }
            }
        }
    }

    private computeMaxRootArea(program: AST.Program): number {
        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        let maxRootArea = 0;
        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            if (calledFunctions.has(decl.name)) continue;

            const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!sym) continue;

            const callsLiveChain = (this.callGraph.get(decl.name)?.size ?? 0) > 0;
            if (!callsLiveChain) continue;

            let rootArea = 0;
            for (const p of sym.parameters) {
                rootArea += p.isByRef ? 4 : (p.dataType?.size ?? 2);
            }

            const perStmt = this.countTempVarsPerStatement(decl.body);
            let maxSlots = 0;
            for (const n of perStmt) {
                const concurrent = n >= 2 ? 2 : n;
                if (concurrent > maxSlots) maxSlots = concurrent;
            }
            const scalarCount = this.countFunctionPreEvalScalars(decl);
            const tempSize = maxSlots * this.getFuncTempSlotSize(decl.name) + scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

            if (decl.name.startsWith('on_')) {
                let localsSize = 0;
                for (const v of sym.localVariables) {
                    localsSize += v.dataType?.size ?? 2;
                }
                const activeFootprint = this.computeOnEventActiveFootprint(decl, sym, tempSize);
                rootArea += Math.max(localsSize, tempSize, activeFootprint);
            } else {
                for (const v of sym.localVariables) {
                    rootArea += v.dataType?.size ?? 2;
                }
                rootArea += tempSize;
            }

            if (rootArea > maxRootArea) maxRootArea = rootArea;
        }
        return maxRootArea;
    }

    private computeOnEventActiveFootprint(
        decl: AST.SubDecl | AST.FunctionDecl,
        sym: FunctionSymbol,
        _tempSize: number
    ): number {
        const slotSize = this.getFuncTempSlotSize(decl.name);
        const scalarCount = this.countFunctionPreEvalScalars(decl);
        const scalarSize = scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

        const varSizeMap = new Map<string, number>();
        for (const v of sym.localVariables) {
            varSizeMap.set(v.name.toLowerCase(), v.dataType?.size ?? 2);
        }

        let maxFootprint = 0;

        const walkStmts = (stmts: AST.Statement[], declaredBytes: number): void => {
            for (const stmt of stmts) {
                const stmtTempCount = this.countTempVarsInNode(stmt);
                const returnSize = this.getStmtDiscardedReturnSize(stmt);

                if (stmtTempCount > 0 || returnSize > 0) {
                    const concurrent = stmtTempCount >= 2 ? 2 : stmtTempCount;
                    const stmtTempSize = concurrent * slotSize + (concurrent > 0 ? scalarSize : 0);
                    const returnFits = returnSize > 0 && (concurrent - 1) * slotSize + scalarSize >= returnSize;
                    const footprint = declaredBytes + stmtTempSize + (returnFits ? 0 : returnSize);
                    if (footprint > maxFootprint) maxFootprint = footprint;
                }

                if (stmt.kind === 'DimStmt') {
                    for (const v of stmt.variables) {
                        const size = varSizeMap.get(v.name.toLowerCase());
                        if (size !== undefined) declaredBytes += size;
                    }
                }

                if (stmt.kind === 'ForStmt') {
                    const saved = declaredBytes;
                    walkStmts(stmt.body, declaredBytes);
                    declaredBytes = saved;
                } else if (stmt.kind === 'WhileStmt') {
                    const saved = declaredBytes;
                    walkStmts(stmt.body, declaredBytes);
                    declaredBytes = saved;
                } else if (stmt.kind === 'IfStmt') {
                    walkStmts(stmt.thenBody, declaredBytes);
                    for (const br of stmt.elseIfBranches) {
                        walkStmts(br.body, declaredBytes);
                    }
                    if (stmt.elseBody) {
                        walkStmts(stmt.elseBody, declaredBytes);
                    }
                } else if (stmt.kind === 'DoLoopStmt') {
                    const saved = declaredBytes;
                    walkStmts(stmt.body, declaredBytes);
                    declaredBytes = saved;
                } else if (stmt.kind === 'SelectCaseStmt') {
                    for (const c of stmt.cases) {
                        walkStmts(c.body, declaredBytes);
                    }
                    if (stmt.defaultCase) {
                        walkStmts(stmt.defaultCase, declaredBytes);
                    }
                }
            }
        };

        walkStmts(decl.body, 0);
        return maxFootprint;
    }

    private getStmtDiscardedReturnSize(stmt: AST.Statement): number {
        if (stmt.kind !== 'ExpressionStmt') return 0;
        const expr = stmt.expression;
        if (expr.kind !== 'CallExpr') return 0;
        if (expr.callee.kind !== 'IdentifierExpr') return 0;
        const sym = this.symbols.current.lookup(expr.callee.name);
        if (!sym || sym.kind !== SymbolKind.Function) return 0;
        const fn = sym as FunctionSymbol;
        if (!fn.returnType || isString(fn.returnType)) return 0;
        return fn.returnType.size ?? 2;
    }

    private allocateCalledFunctionParams(program: AST.Program, maxRootArea: number): void {
        const localBase = this.platformSize + Math.max(this.globalDataOffset, this.projectGlobalAllocSize) + this.stackSize;
        const paramBase = localBase + maxRootArea;

        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        const roots: string[] = [];
        for (const name of this.callGraph.keys()) {
            if (!calledFunctions.has(name)) roots.push(name);
        }

        const depthMap = new Map<string, number>();
        const assignDepth = (caller: string, parentDepth: number) => {
            const calls = this.callGraph.get(caller);
            if (!calls) return;
            for (const c of calls) {
                if (!calledFunctions.has(c)) continue;
                const childDepth = parentDepth + 1;
                const existing = depthMap.get(c);
                if (existing !== undefined && existing >= childDepth) continue;
                depthMap.set(c, childDepth);
                assignDepth(c, childDepth);
            }
        };
        for (const root of roots) assignDepth(root, 0);

        const maxDepth = depthMap.size > 0 ? Math.max(...depthMap.values()) : 0;
        const depthGroups: string[][] = [];
        for (let d = 1; d <= maxDepth; d++) {
            const group: string[] = [];
            for (const [name, depth] of depthMap) {
                if (depth === d) group.push(name);
            }
            if (group.length > 0) depthGroups.push(group);
        }

        const callerOf = new Map<string, Set<string>>();
        for (const [caller, callees] of this.callGraph) {
            for (const callee of callees) {
                if (!calledFunctions.has(callee)) continue;
                if (!callerOf.has(callee)) callerOf.set(callee, new Set());
                callerOf.get(callee)!.add(caller);
            }
        }

        // Phase 1: compute frame sizes without assigning addresses
        const frameSizes = new Map<string, number>();
        for (const group of depthGroups) {
            for (const fnName of group) {
                const sym = this.symbols.lookupGlobal(fnName) as FunctionSymbol | undefined;
                if (!sym) continue;
                const isLive = this.liveReachable.has(fnName);
                const isFuncWithReturn = sym.kind === SymbolKind.Function && !!sym.returnType;

                let size = 0;
                if (isLive) {
                    for (const v of sym.parameters) {
                        size += v.isByRef ? 4 : (v.dataType?.size ?? 2);
                    }
                    if (isFuncWithReturn) size += 4;
                    for (const v of sym.localVariables) {
                        if (isFuncWithReturn && v.name.toLowerCase() === sym.name.toLowerCase()) continue;
                        size += v.dataType?.size ?? 2;
                    }

                    const decl = program.declarations.find(d =>
                        (d.kind === 'SubDecl' || d.kind === 'FunctionDecl') && d.name.toLowerCase() === fnName.toLowerCase()
                    );
                    if (decl && (decl.kind === 'SubDecl' || decl.kind === 'FunctionDecl')) {
                        const perStmtTail = this.countTempVarsPerStatement(decl.body);
                        let maxSlotsTail = 0;
                        for (const n of perStmtTail) {
                            const concurrent = n >= 2 ? 2 : n;
                            if (concurrent > maxSlotsTail) maxSlotsTail = concurrent;
                        }
                        const scalarCountTail = this.countFunctionPreEvalScalars(decl);
                        const tailTempSize =
                            maxSlotsTail * this.getFuncTempSlotSize(fnName) +
                            scalarCountTail * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
                        size += tailTempSize;
                    }
                }
                frameSizes.set(fnName, size);
            }
        }

        // Phase 2: compute per-function start offsets based on caller frame ends
        const funcStartOffset = new Map<string, number>();
        for (const group of depthGroups) {
            for (const fnName of group) {
                const depth = depthMap.get(fnName) ?? 1;
                if (depth === 1) {
                    funcStartOffset.set(fnName, 0);
                } else {
                    const callers = callerOf.get(fnName);
                    let maxCallerEnd = 0;
                    if (callers) {
                        for (const caller of callers) {
                            if (!calledFunctions.has(caller)) continue;
                            const callerStart = funcStartOffset.get(caller) ?? 0;
                            const callerSize = frameSizes.get(caller) ?? 0;
                            maxCallerEnd = Math.max(maxCallerEnd, callerStart + callerSize);
                        }
                    }
                    funcStartOffset.set(fnName, maxCallerEnd);
                }
            }
        }

        // Phase 3: assign addresses using per-function offsets
        for (const group of depthGroups) {
            for (const fnName of group) {
                const sym = this.symbols.lookupGlobal(fnName) as FunctionSymbol | undefined;
                if (!sym) continue;
                const isLive = this.liveReachable.has(fnName);
                const isFuncWithReturn = sym.kind === SymbolKind.Function && !!sym.returnType;
                const startOffset = funcStartOffset.get(fnName) ?? 0;

                let offset = startOffset;

                if (isLive) {
                    for (let i = 0; i < sym.parameters.length; i++) {
                        const v = sym.parameters[i];
                        v.address = paramBase + offset;
                        if (this.resolveDataAddresses) {
                            const labelName = `?A:${sym.name}:${i}`;
                            this.localVarLabelMap.set(v, labelName);
                            this.emitter.defineDataLabel(labelName, v.address);
                        }
                        offset += v.isByRef ? 4 : (v.dataType?.size ?? 2);
                    }
                    if (isFuncWithReturn) {
                        const retPtrAddr = paramBase + offset;
                        this.functionReturnPtrAddr.set(fnName, retPtrAddr);
                        offset += 4;

                        const retVar = sym.localVariables.find(
                            v => v.name.toLowerCase() === sym.name.toLowerCase()
                        );
                        if (retVar) {
                            retVar.address = retPtrAddr;
                            retVar.isByRef = true;
                            if (this.resolveDataAddresses) {
                                const retLabelName = `?A:${sym.name}:${sym.parameters.length + 1}`;
                                this.localVarLabelMap.set(retVar, retLabelName);
                                this.emitter.defineDataLabel(retLabelName, retPtrAddr);
                            }
                        }
                    }
                    for (const v of sym.localVariables) {
                        if (isFuncWithReturn && v.name.toLowerCase() === sym.name.toLowerCase()) continue;
                        v.address = paramBase + offset;
                        offset += v.dataType?.size ?? 2;
                    }

                    const decl = program.declarations.find(d =>
                        (d.kind === 'SubDecl' || d.kind === 'FunctionDecl') && d.name.toLowerCase() === fnName.toLowerCase()
                    );
                    if (decl && (decl.kind === 'SubDecl' || decl.kind === 'FunctionDecl')) {
                        const perStmtTail = this.countTempVarsPerStatement(decl.body);
                        let maxSlotsTail = 0;
                        for (const n of perStmtTail) {
                            const concurrent = n >= 2 ? 2 : n;
                            if (concurrent > maxSlotsTail) maxSlotsTail = concurrent;
                        }
                        const scalarCountTail = this.countFunctionPreEvalScalars(decl);
                        const tailTempSize =
                            maxSlotsTail * this.getFuncTempSlotSize(fnName) +
                            scalarCountTail * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
                        if (tailTempSize > 0) {
                            this.functionTempBase.set(fnName, paramBase + offset);
                            offset += tailTempSize;
                        }
                    }
                }
            }
        }

        let maxEnd = 0;
        for (const [fnName, startOff] of funcStartOffset) {
            const end = startOff + (frameSizes.get(fnName) ?? 0);
            if (end > maxEnd) maxEnd = end;
        }
        const totalSize = maxRootArea + maxEnd;
        if (totalSize > this.localAllocSize) {
            this.localAllocSize = totalSize;
        }
    }

    private getCallChainOrder(calledFunctions: Set<string>): string[] {
        const result: string[] = [];
        const visited = new Set<string>();

        const roots: string[] = [];
        for (const name of this.callGraph.keys()) {
            if (!calledFunctions.has(name)) roots.push(name);
        }

        const queue: string[] = [];
        for (const root of roots) {
            const calls = this.callGraph.get(root);
            if (calls) {
                for (const c of calls) {
                    if (calledFunctions.has(c) && !visited.has(c)) {
                        queue.push(c);
                    }
                }
            }
        }

        while (queue.length > 0) {
            const name = queue.shift()!;
            if (visited.has(name)) continue;
            visited.add(name);
            result.push(name);
            const calls = this.callGraph.get(name);
            if (calls) {
                for (const c of calls) {
                    if (calledFunctions.has(c) && !visited.has(c)) {
                        queue.push(c);
                    }
                }
            }
        }

        return result;
    }

    private allocateLocals(_fn: FunctionSymbol): void {
        // Addresses already assigned in allocateFunctionFrames
    }

    private includeTempsInLocalAllocSize(program: AST.Program): void {
        const frameSizes = new Map<string, number>();
        const tempFootprints = new Map<string, number>();

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            const fn = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!fn || fn.isDeclare) continue;

            let declaredSize = 0;
            for (const p of fn.parameters) {
                declaredSize += p.isByRef ? 4 : (p.dataType?.size ?? 2);
            }
            for (const v of fn.localVariables) {
                declaredSize += v.dataType?.size ?? 2;
            }

            const perStmt = this.countTempVarsPerStatement(decl.body);
            let maxSlots = 0;
            for (const n of perStmt) {
                const concurrent = n >= 2 ? 2 : n;
                if (concurrent > maxSlots) maxSlots = concurrent;
            }
            const scalarCount = this.countFunctionPreEvalScalars(decl);
            const tempFootprint = maxSlots * this.getFuncTempSlotSize(decl.name)
                + scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

            frameSizes.set(decl.name, declaredSize);
            tempFootprints.set(decl.name, tempFootprint);
        }

        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        let maxRootTempExt = 0;
        for (const [name, tempFp] of tempFootprints) {
            if (calledFunctions.has(name)) continue;
            if (tempFp === 0) continue;
            const fn = this.symbols.lookupGlobal(name) as FunctionSymbol | undefined;
            if (!fn) continue;
            let prefix = 0;
            if (fn.name.startsWith('on_')) {
                for (const p of fn.parameters) prefix += p.isByRef ? 4 : (p.dataType?.size ?? 2);
            } else {
                prefix = this.eventFramePrefixBytes(fn);
            }
            const ext = prefix + tempFp;
            if (ext > maxRootTempExt) maxRootTempExt = ext;
        }
        this.rootTempScratchSize = maxRootTempExt;

        for (const [name] of frameSizes) {
            if (calledFunctions.has(name)) continue;
            if (name.startsWith('on_')) continue;
            if (!this.liveReachable.has(name)) continue;
            const rootSize = frameSizes.get(name) ?? 0;
            if (rootSize > this.localAllocSize) {
                this.localAllocSize = rootSize;
            }
        }
    }

    private computeTempStringSlots(program: AST.Program): number {
        let maxSlots = 0;
        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            const perStmt = this.countTempVarsPerStatement(decl.body);
            for (const n of perStmt) {
                const concurrent = n >= 2 ? 2 : n;
                if (concurrent > maxSlots) maxSlots = concurrent;
            }
        }
        return maxSlots;
    }

    private exprTreeHasStringCall(node: unknown): boolean {
        if (!node || typeof node !== 'object') return false;
        const n = node as Record<string, unknown>;
        if (n.kind === 'CallExpr') {
            const callee = n.callee as Record<string, unknown> | undefined;
            if (callee?.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(callee.name as string);
                if (sym?.kind === SymbolKind.Syscall) {
                    const sc = sym as SyscallSymbol;
                    if (sc.returnType && isString(sc.returnType)) return true;
                }
                if (sym?.kind === SymbolKind.Function) {
                    const fn = sym as FunctionSymbol;
                    if (fn.returnType && isString(fn.returnType)) return true;
                }
            }
            if (callee?.kind === 'MemberExpr') {
                const obj = (callee as Record<string, unknown>).object as Record<string, unknown> | undefined;
                if (obj?.kind === 'IdentifierExpr') {
                    const objSym = this.symbols.current.lookup(obj.name as string);
                    if (objSym?.kind === SymbolKind.Object) {
                        const objS = objSym as ObjectSymbol;
                        const prop = (callee as Record<string, unknown>).property as string;
                        if (prop) {
                            const fn = objS.functions.get(prop.toLowerCase());
                            if (fn?.returnType && isString(fn.returnType)) return true;
                        }
                    }
                }
            }
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'kind') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                if (child.some((c: unknown) => this.exprTreeHasStringCall(c))) return true;
            } else if (child && typeof child === 'object' && (child as Record<string, unknown>).kind) {
                if (this.exprTreeHasStringCall(child)) return true;
            }
        }
        return false;
    }

    private countTempVarsForCall(callExpr: AST.CallExpr): number {
        let count = 0;
        let params: VariableSymbol[] | undefined;

        if (callExpr.callee.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(callExpr.callee.name);
            if (sym?.kind === SymbolKind.Syscall) {
                params = (sym as SyscallSymbol).parameters;
            } else if (sym?.kind === SymbolKind.Function || sym?.kind === SymbolKind.Sub) {
                params = (sym as FunctionSymbol).parameters;
                const fn = sym as FunctionSymbol;
                if (fn.returnType && isString(fn.returnType)) {
                    count++;
                }
            }
        } else if (callExpr.callee.kind === 'MemberExpr' && callExpr.callee.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(callExpr.callee.object.name);
            if (objSym?.kind === SymbolKind.Object) {
                const fn = (objSym as ObjectSymbol).functions.get(callExpr.callee.property.toLowerCase());
                if (fn) params = fn.parameters;
            }
        }

        if (!params) return 0;

        for (let i = 0; i < callExpr.args.length && i < params.length; i++) {
            const param = params[i];
            const arg = callExpr.args[i];
            const paramDt = param.dataType;
            const isStringParam = paramDt && isString(paramDt);
            const isByRefParam = param.isByRef;

            if (isByRefParam || isStringParam) {
                if (arg.kind === 'IdentifierExpr') continue;
                count++;
                if (this.isStringExpression(arg) && arg.kind === 'BinaryExpr' && arg.op === AST.BinaryOp.Add) {
                    count += this.countStringCallsInConcat(arg);
                }
            }
        }
        return count;
    }

    private countStringCallsInConcat(expr: AST.Expression, isFirst = false): number {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            return this.countStringCallsInConcat(expr.left, isFirst) + this.countStringCallsInConcat(expr.right);
        }
        if (expr.kind === 'CallExpr' && this.isStringExpression(expr)) return 1;
        if (expr.kind === 'StringLiteral' && !isFirst) return 1;
        return 0;
    }

    private countTempVarsInNode(node: unknown): number {
        if (!node || typeof node !== 'object') return 0;
        const n = node as Record<string, unknown>;
        let count = 0;
        if (n.kind === 'CallExpr') {
            count += this.countTempVarsForCall(n as unknown as AST.CallExpr);
        }
        if (n.kind === 'DimStmt') {
            const dimStmt = n as unknown as AST.DimStmt;
            if (dimStmt.initializer
                && dimStmt.initializer.kind === 'BinaryExpr'
                && (dimStmt.initializer as AST.BinaryExpr).op === AST.BinaryOp.Add
                && this.isStringExpression(dimStmt.initializer)
                && this.tryFoldStringConcat(dimStmt.initializer) === null) {
                count += 1;
            }
        }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'kind') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    count += this.countTempVarsInNode(c);
                }
            } else if (child && typeof child === 'object' && (child as Record<string, unknown>).kind) {
                count += this.countTempVarsInNode(child);
            }
        }
        return count;
    }

    private countTempVarsPerStatement(stmts: AST.Statement[]): number[] {
        const result: number[] = [];
        for (const stmt of stmts) {
            const n = this.countTempVarsInNode(stmt);
            if (n > 0) result.push(n);
            if (stmt.kind === 'IfStmt') {
                result.push(...this.countTempVarsPerStatement(stmt.thenBody));
                for (const br of stmt.elseIfBranches) result.push(...this.countTempVarsPerStatement(br.body));
                if (stmt.elseBody) result.push(...this.countTempVarsPerStatement(stmt.elseBody));
            } else if (stmt.kind === 'WhileStmt') {
                result.push(...this.countTempVarsPerStatement(stmt.body));
            } else if (stmt.kind === 'ForStmt') {
                result.push(...this.countTempVarsPerStatement(stmt.body));
            } else if (stmt.kind === 'DoLoopStmt') {
                result.push(...this.countTempVarsPerStatement(stmt.body));
            } else if (stmt.kind === 'SelectCaseStmt') {
                for (const c of stmt.cases) result.push(...this.countTempVarsPerStatement(c.body));
                if (stmt.defaultCase) result.push(...this.countTempVarsPerStatement(stmt.defaultCase));
            }
        }
        return result;
    }

    private registerTempVariables(program: AST.Program): void {
        let globalTmpCounter = 0;

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;

            const fn = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!fn || fn.isDeclare) continue;

            const isFuncWithReturn = fn.kind === SymbolKind.Function && !!fn.returnType;

            const perStmt = this.countTempVarsPerStatement(decl.body);
            const total = perStmt.reduce((a, b) => a + b, 0);
            const scalarCount = this.countFunctionPreEvalScalars(decl);

            if (total === 0 && scalarCount === 0) continue;

            const fnTempBase = this.functionTempBase.get(fn.name);
            let rootPrefix = 0;
            if (fn.name.startsWith('on_')) {
                for (const p of fn.parameters) rootPrefix += p.isByRef ? 4 : (p.dataType?.size ?? 2);
            } else {
                rootPrefix = this.eventFramePrefixBytes(fn);
            }
            const tempBase = fnTempBase ?? this.tempScratchBase + rootPrefix;

            if (total > 0) {
                const slotAssignments: number[] = [];
                for (const stmtCount of perStmt) {
                    for (let s = 0; s < stmtCount; s++) {
                        slotAssignments.push(Math.min(s, 1));
                    }
                }

                const slot1Offset = this.getFuncTempSlotSize(fn.name) +
                    scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

                for (let i = 0; i < slotAssignments.length; i++) {
                    globalTmpCounter++;
                    const slot = slotAssignments[i];
                    const addr = tempBase + (slot === 0 ? 0 : slot1Offset);
                    const tmpVar: VariableSymbol = {
                        name: `_tmp_${globalTmpCounter}`,
                        kind: SymbolKind.Variable,
                        dataType: BUILTIN_TYPES.string,
                        location: { file: '', line: 0, column: 0 },
                        isPublic: false,
                        isDeclare: false,
                        isByRef: false,
                        isGlobal: false,
                        isTemp: true,
                        address: addr,
                    };
                    fn.localVariables.push(tmpVar);
                }
            }

            if (scalarCount > 0) {
                const scalarAddr = tempBase + this.getFuncTempSlotSize(fn.name);
                const nrVar: VariableSymbol = {
                    name: '_tmp_numeric_result',
                    kind: SymbolKind.Variable,
                    dataType: BUILTIN_TYPES.dword,
                    location: { file: '', line: 0, column: 0 },
                    isPublic: false,
                    isDeclare: false,
                    isByRef: false,
                    isGlobal: false,
                    isTemp: true,
                    address: scalarAddr,
                };
                fn.localVariables.push(nrVar);
            }
        }
    }

    private assignLocalVarLabels(program: AST.Program): void {
        if (!this.resolveDataAddresses) return;

        let globalOrdinal = 1;

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;

            const fn = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!fn || fn.isDeclare) continue;

            const isFuncWithReturn = fn.kind === SymbolKind.Function && !!fn.returnType;

            for (const v of fn.localVariables) {
                if (isFuncWithReturn && v.name.toLowerCase() === fn.name.toLowerCase()) continue;
                if (v.isTemp) continue;
                if (v.address == null) continue;

                const labelName = `?V:${v.name}:local(${fn.name}:${globalOrdinal})`;
                this.localVarLabelMap.set(v, labelName);
                this.emitter.defineDataLabel(labelName, v.address);
                globalOrdinal++;
            }

            for (const v of fn.localVariables) {
                if (!v.isTemp) continue;
                if (v.address == null) continue;

                const labelName = `?V:${v.name}:local(${fn.name}:${globalOrdinal})`;
                this.localVarLabelMap.set(v, labelName);
                this.emitter.defineDataLabel(labelName, v.address);
                globalOrdinal++;
            }
        }
    }

    // ─── Global init ────────────────────────────────────────────────────────

    private generateGlobalInit(program: AST.Program): void {
        for (const decl of program.declarations) {
            if (decl.kind !== 'DimStmt' || decl.isDeclare) continue;
            if (!this.isFromCurrentFile(decl)) continue;

            for (const v of decl.variables) {
                const sym = this.symbols.lookupGlobal(v.name) as VariableSymbol | undefined;
                if (!sym) continue;
                const dt = sym.dataType;
                if (!dt) continue;

                if (isString(dt)) {
                    const strType = dt as StringDataType;
                    const loadOp = strType.maxLength <= 127 ? OP.OPCODE_LOA16I : OP.OPCODE_LOA16;
                    this.emitter.emitByte(loadOp | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(strType.maxLength << 8);
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitVarDataAddress(sym);
                }

                if (isStruct(dt) || isArray(dt)) {
                    this.emitInitObj(sym);
                }

                if (decl.initializer) {
                    if (isString(dt) && decl.initializer.kind === 'StringLiteral') {
                        const strLit = decl.initializer as AST.StringLiteral;
                        const rdataOffset = this.emitter.addStringRData(strLit.value);
                        this.emitVarLeaArg(sym);
                        this.emitRDataLoad(rdataOffset);
                        this.emitSyscallArg(1);
                        this.emitSyscallByName('strload');
                    } else if (this.tryEmitPropertyGetterDirect(decl.initializer, sym.address ?? 0)) {
                        // Property getter stores directly into variable
                    } else if (isString(dt) && decl.initializer.kind === 'IdentifierExpr') {
                        const srcSym = this.symbols.current.lookup((decl.initializer as AST.IdentifierExpr).name);
                        if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                            const src = srcSym as VariableSymbol;
                            if (src.dataType && isString(src.dataType)) {
                                this.emitVarLeaArg(sym);
                                this.emitter.emitByte(OP.OPCODE_LEA);
                                this.emitVarDataAddress(src);
                                this.emitSyscallArg(1);
                                this.emitSyscallByName('strcpy');
                            }
                        }
                    } else if (!isString(dt)) {
                        this.generateExpression(decl.initializer);
                        this.emitStore(sym);
                    }
                }

                if (decl.arrayInitializer && isArray(dt)) {
                    this.emitArrayInitializer(sym.address ?? 0, dt, decl.arrayInitializer);
                }
            }
        }
    }

    // ─── Sub / Function ─────────────────────────────────────────────────────

    private generateSub(decl: AST.SubDecl): void {
        const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
        if (!sym) return;

        const endLabel = this.makeLabel('sub_end');
        this.ctx.currentFunction = sym;
        this.ctx.functionEndLabel = endLabel;

        this.onEventDeclaredLocalBytes = 0;
        this.onEventStackSlotBytes = 0;
        if (sym.name.startsWith('on_')) {
            for (const par of sym.parameters) {
                const psz = par.isByRef ? 4 : (par.dataType?.size ?? 2);
                this.onEventDeclaredLocalBytes += psz;
                this.onEventStackSlotBytes += (psz + 1) & ~1;
            }
        }
        this.symbols.pushScope(undefined as any);
        for (const p of sym.parameters) this.symbols.current.define(p);
        for (const v of sym.localVariables) this.symbols.current.define(v);

        sym.codeStartAddress = this.emitter.currentOffset;
        this.emitter.defineLabel(decl.name);
        this.allocateLocals(sym);
        this.generateBlock(decl.body);
        this.emitter.defineLabel(endLabel);
        if (decl.endLoc) {
            this.emitter.addLineInfo(this.emitter.currentOffset, decl.endLoc.line);
        }
        this.emitter.emitByte(OP.OPCODE_RET);
        sym.codeEndAddress = this.emitter.currentOffset;
        sym.endLoc = decl.endLoc;

        this.symbols.popScope();
        this.ctx.currentFunction = undefined;
        this.ctx.functionEndLabel = undefined;
    }

    private generateFunction(decl: AST.FunctionDecl): void {
        const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
        if (!sym) return;

        const endLabel = this.makeLabel('func_end');
        this.ctx.currentFunction = sym;
        this.ctx.functionEndLabel = endLabel;

        this.onEventDeclaredLocalBytes = 0;
        this.onEventStackSlotBytes = 0;
        if (sym.name.startsWith('on_')) {
            for (const par of sym.parameters) {
                const psz = par.isByRef ? 4 : (par.dataType?.size ?? 2);
                this.onEventDeclaredLocalBytes += psz;
                this.onEventStackSlotBytes += (psz + 1) & ~1;
            }
        }
        this.symbols.pushScope(undefined as any);
        for (const p of sym.parameters) this.symbols.current.define(p);
        for (const v of sym.localVariables) this.symbols.current.define(v);

        sym.codeStartAddress = this.emitter.currentOffset;
        this.emitter.defineLabel(decl.name);
        this.allocateLocals(sym);
        this.generateBlock(decl.body);
        this.emitter.defineLabel(endLabel);
        if (decl.endLoc) {
            this.emitter.addLineInfo(this.emitter.currentOffset, decl.endLoc.line);
        }
        this.emitter.emitByte(OP.OPCODE_RET);
        sym.codeEndAddress = this.emitter.currentOffset;
        sym.endLoc = decl.endLoc;

        this.symbols.popScope();
        this.ctx.currentFunction = undefined;
        this.ctx.functionEndLabel = undefined;
    }

    // ─── Block / Statement ──────────────────────────────────────────────────

    private generateBlock(stmts: AST.Statement[]): void {
        for (const stmt of stmts) this.generateStatement(stmt);
    }

    private generateStatement(stmt: AST.Statement): void {
        this.emitter.addLineInfo(this.emitter.currentOffset, stmt.loc.line);

        switch (stmt.kind) {
            case 'ExpressionStmt': this.generateExpressionStmt(stmt); break;
            case 'LabelStmt': this.emitter.defineLabel(stmt.name); break;
            case 'GotoStmt': this.generateGoto(stmt); break;
            case 'ExitStmt': this.generateExit(stmt); break;
            case 'IfStmt': this.generateIf(stmt); break;
            case 'SelectCaseStmt': this.generateSelectCase(stmt); break;
            case 'ForStmt': this.generateFor(stmt); break;
            case 'WhileStmt': this.generateWhile(stmt); break;
            case 'DoLoopStmt': this.generateDoLoop(stmt); break;
            case 'DimStmt': this.generateDimLocal(stmt); break;
            case 'ConstDecl': break;
        }
    }

    // ─── Expression statement ───────────────────────────────────────────────

    private generateExpressionStmt(stmt: AST.ExpressionStmt): void {
        const expr = stmt.expression;
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Eq) {
            this.generateAssignment(expr.left, expr.right);
        } else if (expr.kind === 'CallExpr') {
            this.isStatementCall = true;
            this.generateCall(expr);
            this.isStatementCall = false;
        } else {
            this.generateExpression(expr);
        }
    }

    private generateAssignment(target: AST.Expression, value: AST.Expression): void {
        if (target.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(target.name);
            if (!sym) {
                this.diagnostics.error(target.loc, `Undefined variable: '${target.name}'`);
                return;
            }
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.checkNotDeclareOnly(varSym, target.loc);
                const dt = varSym.dataType;
                if (dt && isString(dt)) {
                    this.generateStringAssignment(varSym, value);
                    return;
                }
                const currentFn = this.ctx.currentFunction;
                if (currentFn && currentFn.kind === SymbolKind.Function &&
                    varSym.name.toLowerCase() === currentFn.name.toLowerCase()) {
                    const retPtrAddr = this.functionReturnPtrAddr.get(currentFn.name);
                    if (retPtrAddr !== undefined) {
                        this.generateExpression(value);
                        const storeOp = getStoreOpcode(dt ?? BUILTIN_TYPES.word);
                        this.emitter.emitByte(storeOp | OP.OPCODE_INDIRECT);
                        this.emitter.emitDataAddress(retPtrAddr);
                        return;
                    }
                }
                if (this.tryEmitPropertyGetterDirect(value, varSym.address ?? 0)) {
                    return;
                }
                this.generateExpression(value);
                this.emitStore(varSym);
                return;
            }
            if (sym && sym.kind === SymbolKind.Function) {
                this.generateExpression(value);
                const fn = sym as FunctionSymbol;
                if (fn.address !== undefined) {
                    this.emitter.emitByte(getStoreOpcode(fn.returnType ?? BUILTIN_TYPES.word) | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(fn.address);
                }
                return;
            }
        }
        if (target.kind === 'MemberExpr') {
            this.generateMemberAssignment(target, value);
            return;
        }
        if (target.kind === 'IndexExpr') {
            this.generateIndexAssignment(target, value);
            return;
        }
        if (target.kind === 'CallExpr') {
            const call = target as AST.CallExpr;
            if (call.callee.kind === 'IdentifierExpr') {
                const calleeIdent = call.callee as AST.IdentifierExpr;
                const sym = this.symbols.current.lookup(calleeIdent.name);
                if (!sym) {
                    this.diagnostics.error(call.callee.loc, `Undefined variable: '${calleeIdent.name}'`);
                    return;
                }
                if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                    const varSym = sym as VariableSymbol;
                    this.checkNotDeclareOnly(varSym, call.callee.loc);
                    const dt = varSym.dataType;
                    if (dt && isArray(dt)) {
                        const elementType = (dt as ArrayDataType).elementType;

                        if (call.args.length > 0 && call.args[0].kind === 'IntegerLiteral') {
                            const index = (call.args[0] as AST.IntegerLiteral).value;
                            const elementAddr = (varSym.address ?? 0) + index * elementType.size;
                            if (isString(elementType)) {
                                this.generateStringAssignmentToAddr(elementAddr, varSym.isByRef, value);
                            } else {
                                this.generateExpression(value);
                                const storeOp = getStoreOpcode(elementType);
                                const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                                this.emitter.emitByte(storeOp | indirection);
                                this.emitter.emitDataAddress(elementAddr);
                            }
                            return;
                        }

                        this.emitGotoidxStore(varSym, call.args, elementType, value);
                        return;
                    }
                }
            }
        }
        this.generateExpression(value);
    }

    private generateMemberAssignment(target: AST.MemberExpr, value: AST.Expression): void {
        const objExpr = target.object;
        if (objExpr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(objExpr.name);
            if (sym && sym.kind === SymbolKind.Object) {
                const obj = sym as ObjectSymbol;
                const prop = obj.properties.get(target.property.toLowerCase());
                if (prop) {
                    const setNum = prop.setterSyscall;
                    const propDt = prop.dataType;

                    if (propDt && isString(propDt)) {
                        this.emitStringExprToArg(value, 0);
                        if (setNum !== undefined) this.emitSyscall(setNum);
                        return;
                    }

                    this.generateExpression(value);
                    const setterArgSz = propDt && propDt.size >= 1 ? propDt.size : 2;
                    this.emitStoreToArgBuffer(0, setterArgSz);
                    if (setNum !== undefined) {
                        this.emitSyscall(setNum);
                    }
                    return;
                }
                const fn = obj.functions.get(target.property.toLowerCase());
                if (fn) {
                    this.generateExpression(value);
                    const p0 = fn.parameters[0];
                    const argSz = p0 ? this.getSyscallParamStoreSize(p0) : 2;
                    this.emitStoreToArgBuffer(0, argSz);
                    this.emitSyscall(fn.syscallNumber);
                    return;
                }
            }

            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                if (dt && isStruct(dt)) {
                    const member = (dt as StructDataType).memberMap.get(target.property.toLowerCase());
                    if (member) {
                        if (member.dataType && isString(member.dataType)) {
                            const baseAddr = varSym.address ?? 0;
                            const memberAddr = baseAddr + member.offset;
                            this.generateStringAssignmentToAddr(memberAddr, varSym.isByRef, value);
                        } else {
                            this.generateExpression(value);
                            const baseAddr = varSym.address ?? 0;
                            const memberAddr = baseAddr + member.offset;
                            const storeOp = getStoreOpcode(member.dataType);
                            const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                            this.emitter.emitByte(storeOp | indirection);
                            this.emitter.emitDataAddress(memberAddr);
                        }
                        return;
                    }
                }
            }
        }
        this.generateExpression(value);
    }

    private generateStringAssignmentToAddr(addr: number, isByRef: boolean, value: AST.Expression): void {
        this.generateStringAssignment({
            name: '',
            kind: SymbolKind.Variable,
            location: { file: '', line: 0, column: 0 },
            isPublic: false,
            isDeclare: false,
            isByRef,
            isGlobal: false,
            address: addr,
        } as VariableSymbol, value);
    }

    private isStringExpression(expr: AST.Expression): boolean {
        if (expr.kind === 'StringLiteral') return true;
        if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                return !!(sym.dataType && isString(sym.dataType));
            }
            if (sym && sym.kind === SymbolKind.Constant) {
                return typeof (sym as ConstantSymbol).value === 'string';
            }
        }
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
        }
        if (expr.kind === 'CallExpr') {
            if (expr.callee.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(expr.callee.name);
                if (sym && sym.kind === SymbolKind.Function) {
                    const fn = sym as FunctionSymbol;
                    return !!(fn.returnType && isString(fn.returnType));
                }
                if (sym && sym.kind === SymbolKind.Syscall) {
                    const sc = sym as SyscallSymbol;
                    return !!(sc.returnType && isString(sc.returnType));
                }
            }
        }
        if (expr.kind === 'MemberExpr') {
            const dt = this.inferMemberType(expr);
            return !!(dt && isString(dt));
        }
        if (expr.kind === 'ParenExpr') return this.isStringExpression(expr.expression);
        return false;
    }

    // ─── String assignment ──────────────────────────────────────────────────

    private generateStringAssignment(varSym: VariableSymbol, value: AST.Expression): void {
        if (value.kind === 'StringLiteral') {
            const rdataOffset = this.emitter.addStringRData(value.value);
            this.emitVarLeaArg(varSym);
            this.emitRDataLoad(rdataOffset);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strload');
        } else if (value.kind === 'IdentifierExpr') {
            const srcSym = this.symbols.current.lookup(value.name);
            if (srcSym && srcSym.kind === SymbolKind.Constant && typeof (srcSym as ConstantSymbol).value === 'string') {
                const rdataOffset = this.emitter.addStringRData((srcSym as ConstantSymbol).value as string);
                this.emitVarLeaArg(varSym);
                this.emitRDataLoad(rdataOffset);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                return;
            }
            if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                const src = srcSym as VariableSymbol;
                if (src.dataType && isString(src.dataType)) {
                    this.emitVarLeaArg(varSym);
                    this.emitVarLeaArgAt(src, 1);
                    this.emitSyscallByName('strcpy');
                    return;
                }
            }
            this.generateExpression(value);
            this.emitStore(varSym);
        } else if (value.kind === 'BinaryExpr' && value.op === AST.BinaryOp.Add) {
            const folded = this.tryFoldStringConcat(value);
            if (folded !== null) {
                const rdataOffset = this.emitter.addStringRData(folded);
                this.emitVarLeaArg(varSym);
                this.emitRDataLoad(rdataOffset);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
            } else {
                const tempAddr = this.getTempStringAddr(0);
                this.emitStringExprToTemp(value, tempAddr, true);
                this.emitVarLeaArg(varSym);
                this.emitLeaToArg(tempAddr, 1);
                this.emitSyscallByName('strcpy');
            }
        } else if (value.kind === 'MemberExpr') {
            const member = value as AST.MemberExpr;
            if (member.object.kind === 'IdentifierExpr') {
                const objSym = this.symbols.current.lookup(member.object.name);
                if (objSym && objSym.kind === SymbolKind.Object) {
                    const obj = objSym as ObjectSymbol;
                    const prop = obj.properties.get(member.property.toLowerCase());
                    if (prop && prop.getterSyscall !== undefined) {
                        this.emitVarLeaArg(varSym);
                        this.emitSyscall(prop.getterSyscall);
                        return;
                    }
                }
            }
            this.generateExpression(value);
            this.emitStore(varSym);
        } else if (value.kind === 'CallExpr') {
            const foldedChr = this.tryFoldChrCall(value);
            if (foldedChr !== null) {
                const rdataOffset = this.emitter.addStringRData(foldedChr);
                this.emitVarLeaArg(varSym);
                this.emitRDataLoad(rdataOffset);
                this.emitSyscallArg(1);
                this.emitSyscallByName('strload');
                return;
            }
            if (this.emitStringCallResultToAddr(value, varSym.address ?? 0, varSym.isByRef)) {
                return;
            }
            this.generateCall(value);
            this.emitStore(varSym);
        } else {
            this.generateExpression(value);
            this.emitStore(varSym);
        }
    }

    private emitStringCat(destSym: VariableSymbol, expr: AST.Expression): void {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.emitStringCat(destSym, expr.left);
            this.emitStringCat(destSym, expr.right);
            return;
        }

        if (expr.kind === 'StringLiteral') {
            const rdataOffset = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOffset);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strcat');
            return;
        }

        this.emitVarLeaArg(destSym);
        if (expr.kind === 'IdentifierExpr') {
            const srcSym = this.symbols.current.lookup(expr.name);
            if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                const src = srcSym as VariableSymbol;
                this.emitVarLeaArgAt(src, 1);
            }
        } else if (expr.kind === 'CallExpr' && this.emitStringCallResultToAddr(expr, this.getTempStringAddr(0))) {
            this.emitLeaToArg(this.getTempStringAddr(0), 1);
        } else {
            this.generateExpression(expr);
            this.emitSyscallArg(1);
        }
        this.emitSyscallByName('strcat');
    }

    // ─── Goto / Exit ────────────────────────────────────────────────────────

    private generateGoto(stmt: AST.GotoStmt): void {
        this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(stmt.target);
    }

    private generateExit(stmt: AST.ExitStmt): void {
        if (stmt.target === 'sub' || stmt.target === 'function') {
            if (this.ctx.functionEndLabel) {
                this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
                this.emitter.emitLabelReference(this.ctx.functionEndLabel);
            }
        } else if (this.ctx.loopEndLabel) {
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(this.ctx.loopEndLabel);
        }
    }

    // ─── If ─────────────────────────────────────────────────────────────────

    private generateIf(stmt: AST.IfStmt): void {
        const endLabel = this.makeLabel('if_end');

        const elseLabel = (stmt.elseIfBranches.length > 0 || stmt.elseBody) ? this.makeLabel('else') : endLabel;
        this.generateConditionJump(stmt.condition, elseLabel, false);
        const savedLocalBytes = this.onEventDeclaredLocalBytes;
        const savedStackSlots = this.onEventStackSlotBytes;
        this.generateBlock(stmt.thenBody);
        this.onEventDeclaredLocalBytes = savedLocalBytes;
        this.onEventStackSlotBytes = savedStackSlots;

        if (stmt.elseIfBranches.length > 0 || stmt.elseBody) {
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
        }
        this.emitter.defineLabel(elseLabel);

        for (let i = 0; i < stmt.elseIfBranches.length; i++) {
            const branch = stmt.elseIfBranches[i];
            const nextLabel = (i < stmt.elseIfBranches.length - 1 || stmt.elseBody) ? this.makeLabel('elseif') : endLabel;
            this.generateConditionJump(branch.condition, nextLabel, false);
            const savedBranchBytes = this.onEventDeclaredLocalBytes;
            const savedBranchStack = this.onEventStackSlotBytes;
            this.generateBlock(branch.body);
            this.onEventDeclaredLocalBytes = savedBranchBytes;
            this.onEventStackSlotBytes = savedBranchStack;
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
            this.emitter.defineLabel(nextLabel);
        }

        if (stmt.elseBody) {
            const savedElseBytes = this.onEventDeclaredLocalBytes;
            const savedElseStack = this.onEventStackSlotBytes;
            this.generateBlock(stmt.elseBody);
            this.onEventDeclaredLocalBytes = savedElseBytes;
            this.onEventStackSlotBytes = savedElseStack;
        }

        this.emitter.defineLabel(endLabel);
    }

    // ─── Select Case ────────────────────────────────────────────────────────

    /** Matches tide `SelectCaseStatement`: BooleanFalseJmp to next case (JNE on equality). */
    private generateSelectCase(stmt: AST.SelectCaseStmt): void {
        const endLabel = this.makeLabel('select_end');
        let nextCaseEntryLabel = this.makeLabel('select_case_entry');

        for (let i = 0; i < stmt.cases.length; i++) {
            const c = stmt.cases[i];
            this.emitter.defineLabel(nextCaseEntryLabel);
            nextCaseEntryLabel = this.makeLabel(`select_case_${i + 1}`);

            const hasMultiple = c.conditions.length > 1;
            const sharedBodyLabel = hasMultiple ? this.makeLabel('select_multi') : null;

            for (let j = 0; j < c.conditions.length; j++) {
                const cond = c.conditions[j];
                const isLast = j === c.conditions.length - 1;
                this.emitTypedComparison(stmt.testExpr, cond);
                const signed = relationalComparisonSigned(
                    this.inferType(stmt.testExpr),
                    this.inferType(cond),
                );
                const cmpInfo = getCmpOpInfo('=', signed);
                if (!cmpInfo) {
                    continue;
                }
                if (!isLast) {
                    this.emitter.emitByte(cmpInfo.trueJmp | OP.OPCODE_DIRECT);
                    this.emitter.emitLabelReference(sharedBodyLabel!);
                } else {
                    this.emitter.emitByte(cmpInfo.falseJmp | OP.OPCODE_DIRECT);
                    this.emitter.emitLabelReference(nextCaseEntryLabel);
                }
            }

            if (sharedBodyLabel) {
                this.emitter.defineLabel(sharedBodyLabel);
            }

            const savedCaseBytes = this.onEventDeclaredLocalBytes;
            const savedCaseStack = this.onEventStackSlotBytes;
            this.generateBlock(c.body);
            this.onEventDeclaredLocalBytes = savedCaseBytes;
            this.onEventStackSlotBytes = savedCaseStack;

            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
        }

        this.emitter.defineLabel(nextCaseEntryLabel);
        if (stmt.defaultCase) {
            const savedDefaultBytes = this.onEventDeclaredLocalBytes;
            const savedDefaultStack = this.onEventStackSlotBytes;
            this.generateBlock(stmt.defaultCase);
            this.onEventDeclaredLocalBytes = savedDefaultBytes;
            this.onEventStackSlotBytes = savedDefaultStack;
        }

        this.emitter.defineLabel(endLabel);
    }

    // ─── For ────────────────────────────────────────────────────────────────

    private generateFor(stmt: AST.ForStmt): void {
        const startLabel = this.makeLabel('for_start');
        const endLabel = this.makeLabel('for_end');

        const prevLoopStart = this.ctx.loopStartLabel;
        const prevLoopEnd = this.ctx.loopEndLabel;
        this.ctx.loopStartLabel = startLabel;
        this.ctx.loopEndLabel = endLabel;

        if (stmt.init.kind === 'BinaryExpr' && stmt.init.op === AST.BinaryOp.Eq) {
            this.generateAssignment(stmt.init.left, stmt.init.right);
        }

        this.emitter.defineLabel(startLabel);

        if (stmt.init.kind === 'BinaryExpr' && stmt.init.left.kind === 'IdentifierExpr') {
            const counterName = stmt.init.left.name;
            const counterSym = this.symbols.current.lookup(counterName);
            if (counterSym && (counterSym.kind === SymbolKind.Variable || counterSym.kind === SymbolKind.Parameter)) {
                this.emitLoad(counterSym as VariableSymbol);
                this.emitSecondOperand(stmt.to);
                this.emitter.emitByte(OP.OPCODE_CMP);
                const stepValue = stmt.step !== undefined ? this.evalConstantIntExpr(stmt.step) : 1;
                const exitJump = (stepValue !== undefined && stepValue < 0) ? OP.OPCODE_JB : OP.OPCODE_JA;
                this.emitter.emitByte(exitJump | OP.OPCODE_DIRECT);
                this.emitter.emitLabelReference(endLabel);
            }
        }

        const savedLocalBytes = this.onEventDeclaredLocalBytes;
        const savedStackSlots = this.onEventStackSlotBytes;
        this.generateBlock(stmt.body);
        this.onEventDeclaredLocalBytes = savedLocalBytes;
        this.onEventStackSlotBytes = savedStackSlots;

        if (stmt.init.kind === 'BinaryExpr' && stmt.init.left.kind === 'IdentifierExpr') {
            const counterName = stmt.init.left.name;
            const counterSym = this.symbols.current.lookup(counterName);
            if (counterSym && (counterSym.kind === SymbolKind.Variable || counterSym.kind === SymbolKind.Parameter)) {
                const varSym = counterSym as VariableSymbol;
                this.emitLoad(varSym);
                if (stmt.step) {
                    this.emitSecondOperand(stmt.step);
                } else {
                    this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitByte(1);
                }
                this.emitter.emitByte(OP.OPCODE_ADD);
                this.emitStore(varSym);
            }
        }

        this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(startLabel);
        this.emitter.defineLabel(endLabel);

        this.ctx.loopStartLabel = prevLoopStart;
        this.ctx.loopEndLabel = prevLoopEnd;
    }

    // ─── While ──────────────────────────────────────────────────────────────

    private generateWhile(stmt: AST.WhileStmt): void {
        const startLabel = this.makeLabel('while_start');
        const endLabel = this.makeLabel('while_end');

        const prevLoopStart = this.ctx.loopStartLabel;
        const prevLoopEnd = this.ctx.loopEndLabel;
        this.ctx.loopStartLabel = startLabel;
        this.ctx.loopEndLabel = endLabel;

        this.emitter.defineLabel(startLabel);
        this.generateConditionJump(stmt.condition, endLabel, false);
        const savedLocalBytes = this.onEventDeclaredLocalBytes;
        const savedStackSlots = this.onEventStackSlotBytes;
        this.generateBlock(stmt.body);
        this.onEventDeclaredLocalBytes = savedLocalBytes;
        this.onEventStackSlotBytes = savedStackSlots;
        this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(startLabel);
        this.emitter.defineLabel(endLabel);

        this.ctx.loopStartLabel = prevLoopStart;
        this.ctx.loopEndLabel = prevLoopEnd;
    }

    // ─── Do/Loop ────────────────────────────────────────────────────────────

    private generateDoLoop(stmt: AST.DoLoopStmt): void {
        const startLabel = this.makeLabel('do_start');
        const endLabel = this.makeLabel('do_end');

        const prevLoopStart = this.ctx.loopStartLabel;
        const prevLoopEnd = this.ctx.loopEndLabel;
        this.ctx.loopStartLabel = startLabel;
        this.ctx.loopEndLabel = endLabel;

        this.emitter.defineLabel(startLabel);

        if (stmt.loopKind === AST.DoLoopKind.WhilePre && stmt.condition) {
            this.generateConditionJump(stmt.condition, endLabel, false);
        } else if (stmt.loopKind === AST.DoLoopKind.UntilPre && stmt.condition) {
            this.generateConditionJump(stmt.condition, endLabel, true);
        }

        const savedLocalBytes = this.onEventDeclaredLocalBytes;
        const savedStackSlots = this.onEventStackSlotBytes;
        this.generateBlock(stmt.body);
        this.onEventDeclaredLocalBytes = savedLocalBytes;
        this.onEventStackSlotBytes = savedStackSlots;

        if (stmt.loopKind === AST.DoLoopKind.WhilePost && stmt.condition) {
            this.generateConditionJump(stmt.condition, startLabel, true);
        } else if (stmt.loopKind === AST.DoLoopKind.UntilPost && stmt.condition) {
            this.generateConditionJump(stmt.condition, startLabel, false);
        } else {
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(startLabel);
        }

        this.emitter.defineLabel(endLabel);
        this.ctx.loopStartLabel = prevLoopStart;
        this.ctx.loopEndLabel = prevLoopEnd;
    }

    // ─── Dim (local) ────────────────────────────────────────────────────────

    private generateDimLocal(stmt: AST.DimStmt): void {
        for (const v of stmt.variables) {
            const sym = this.symbols.current.lookup(v.name);
            if (!sym || (sym.kind !== SymbolKind.Variable && sym.kind !== SymbolKind.Parameter)) continue;
            const varSym = sym as VariableSymbol;
            const dt = varSym.dataType;
            const addr = varSym.address ?? 0;

            if (dt && isString(dt)) {
                let skipInit = false;
                if (stmt.initializer && stmt.initializer.kind === 'CallExpr') {
                    const callExpr = stmt.initializer as AST.CallExpr;
                    if (callExpr.callee.kind === 'IdentifierExpr') {
                        const calleeSym = this.symbols.current.lookup((callExpr.callee as AST.IdentifierExpr).name);
                        if (calleeSym?.kind === SymbolKind.Syscall) {
                            const sc = calleeSym as SyscallSymbol;
                            skipInit = !!(sc.returnType && isString(sc.returnType));
                        }
                    } else if (callExpr.callee.kind === 'MemberExpr') {
                        const member = callExpr.callee as AST.MemberExpr;
                        if (member.object.kind === 'IdentifierExpr') {
                            const objSym = this.symbols.current.lookup((member.object as AST.IdentifierExpr).name);
                            if (objSym?.kind === SymbolKind.Object) {
                                const fn = (objSym as ObjectSymbol).functions.get(member.property.toLowerCase());
                                skipInit = !!(fn?.returnType && isString(fn.returnType));
                            }
                        }
                    }
                }
                if (!skipInit) {
                    const strType = dt as StringDataType;
                    const loadOp = strType.maxLength <= 127 ? OP.OPCODE_LOA16I : OP.OPCODE_LOA16;
                    this.emitter.emitByte(loadOp | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(strType.maxLength << 8);
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(addr);
                }
            }

            if (dt && (isStruct(dt) || isArray(dt))) {
                this.emitInitObjAtAddr(addr, varSym.isByRef, dt);
            }

            if (this.ctx.currentFunction?.name.startsWith('on_') && !varSym.isTemp) {
                const vsz = varSym.dataType?.size ?? 2;
                this.onEventDeclaredLocalBytes += vsz;
                this.onEventStackSlotBytes += (vsz + 1) & ~1;
            }

            if (stmt.initializer) {
                if (dt && isString(dt) && stmt.initializer.kind === 'StringLiteral') {
                    const strLit = stmt.initializer as AST.StringLiteral;
                    const rdataOffset = this.emitter.addStringRData(strLit.value);
                    this.emitLeaArg(addr);
                    this.emitRDataLoad(rdataOffset);
                    this.emitSyscallArg(1);
                    this.emitSyscallByName('strload');
                } else if (dt && isString(dt)) {
                    this.generateStringAssignment(varSym, stmt.initializer);
                } else if (stmt.initializer.kind === 'StringLiteral' && dt && dt.size >= 4 && isIntegral(dt)) {
                    // tmake: dword/long = "literal" uses strload + lval at runtime, not constant folding
                    const strLit = stmt.initializer as AST.StringLiteral;
                    const tempAddr = this.getTempStringAddr(0);
                    this.emitTempStringInit(tempAddr, strLit.value.length);
                    const rdataOffset = this.emitter.addStringRData(strLit.value);
                    this.emitLeaToArg(tempAddr, 0);
                    this.emitRDataLoad(rdataOffset);
                    this.emitSyscallArg(1);
                    this.emitSyscallByName('strload');
                    this.emitLeaToArg(tempAddr, 0);
                    this.emitVarLeaArgAt(varSym, 1);
                    this.emitSyscallByName('lval');
                } else if (this.tryEmitPropertyGetterDirect(stmt.initializer, addr)) {
                    // Property getter stores directly to local var
                } else if (stmt.initializer.kind === 'CallExpr' && this.canDirectReturnTo(stmt.initializer as AST.CallExpr)) {
                    this.pendingReturnTarget = addr;
                    this.generateExpression(stmt.initializer);
                    this.pendingReturnTarget = undefined;
                } else {
                    this.generateExpression(stmt.initializer);
                    this.emitStore(varSym);
                }
            }

            if (stmt.arrayInitializer && dt && isArray(dt)) {
                this.emitArrayInitializer(addr, dt, stmt.arrayInitializer, varSym.isByRef);
            }
        }
    }

    // ─── Expressions ────────────────────────────────────────────────────────

    private generateExpression(expr: AST.Expression): void {
        switch (expr.kind) {
            case 'IntegerLiteral': this.generateIntLiteral(expr.value); break;
            case 'FloatLiteral': this.generateFloatLiteral(expr.value); break;
            case 'HexLiteral': this.generateIntLiteral(expr.value); break;
            case 'BinLiteral': this.generateIntLiteral(expr.value); break;
            case 'BooleanLiteral': this.generateIntLiteral(expr.value ? 1 : 0); break;
            case 'StringLiteral': this.generateStringLiteral(expr.value); break;
            case 'IdentifierExpr': this.generateIdentifier(expr); break;
            case 'BinaryExpr': this.generateBinary(expr); break;
            case 'UnaryExpr': this.generateUnary(expr); break;
            case 'CallExpr': this.generateCall(expr); break;
            case 'MemberExpr': this.generateMember(expr); break;
            case 'IndexExpr': this.generateIndex(expr); break;
            case 'ParenExpr': this.generateExpression(expr.expression); break;
        }
    }

    private generateIntLiteral(value: number): void {
        if (value >= -128 && value <= 127) {
            this.emitter.emitByte(OP.OPCODE_LOA8I | OP.OPCODE_IMMEDIATE);
            this.emitter.emitByte(value & 0xFF);
        } else if (value >= 0 && value <= 255) {
            this.emitter.emitByte(OP.OPCODE_LOA8 | OP.OPCODE_IMMEDIATE);
            this.emitter.emitByte(value & 0xFF);
        } else if (value >= -32768 && value <= 32767) {
            this.emitter.emitByte(OP.OPCODE_LOA16I | OP.OPCODE_IMMEDIATE);
            this.emitter.emitWord(value & 0xFFFF);
        } else if (value >= 0 && value <= 65535) {
            this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_IMMEDIATE);
            this.emitter.emitWord(value & 0xFFFF);
        } else {
            this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
            this.emitter.emitDword(value);
        }
    }

    private generateFloatLiteral(value: number): void {
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
        this.emitter.emitFloat(value);
    }

    private generateStringLiteral(value: string): void {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
            this.generateIntLiteral(num);
        }
    }

    private generateIdentifier(expr: AST.IdentifierExpr): void {
        const sym = this.symbols.current.lookup(expr.name);
        if (!sym) {
            this.diagnostics.error(expr.loc, `Undefined identifier: ${expr.name}`);
            return;
        }

        switch (sym.kind) {
            case SymbolKind.Variable:
            case SymbolKind.Parameter: {
                const varSym = sym as VariableSymbol;
                this.checkNotDeclareOnly(varSym, expr.loc);
                this.emitLoad(varSym);
                break;
            }
            case SymbolKind.Constant: {
                const constSym = sym as ConstantSymbol;
                if (typeof constSym.value === 'number') {
                    this.generateIntLiteral(constSym.value);
                } else if (typeof constSym.value === 'boolean') {
                    this.generateIntLiteral(constSym.value ? 1 : 0);
                }
                break;
            }
            case SymbolKind.Enum: {
                const enumSym = sym as any;
                if (enumSym.value !== undefined) {
                    this.generateIntLiteral(Number(enumSym.value));
                }
                break;
            }
        }
    }

    // ─── Load / Store helpers ───────────────────────────────────────────────

    private emitLoad(varSym: VariableSymbol): void {
        const dt = varSym.dataType;
        if (!dt) {
            this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_DIRECT);
            this.emitVarDataAddress(varSym);
            return;
        }

        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        const loadOp = getLoadOpcode(dt, 'A');
        this.emitter.emitByte(loadOp | indirection);
        this.emitVarDataAddress(varSym);
    }

    private emitStore(varSym: VariableSymbol): void {
        const dt = varSym.dataType;
        if (!dt) {
            this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
            this.emitVarDataAddress(varSym);
            return;
        }

        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        const storeOp = getStoreOpcode(dt);
        this.emitter.emitByte(storeOp | indirection);
        this.emitVarDataAddress(varSym);
    }

    // ─── Binary operations ──────────────────────────────────────────────────

    private generateBinary(expr: AST.BinaryExpr): void {
        const op = expr.op;

        if (op === AST.BinaryOp.Eq || op === AST.BinaryOp.Neq ||
            op === AST.BinaryOp.Lt || op === AST.BinaryOp.Gt ||
            op === AST.BinaryOp.Leq || op === AST.BinaryOp.Geq) {
            this.generateComparison(expr);
            return;
        }

        const opInfo = BINARY_OPS[op];
        if (!opInfo) {
            this.generateExpression(expr.left);
            return;
        }

        const leftType = this.inferType(expr.left);
        const rightType = this.inferType(expr.right);
        const resultType = leftType && rightType ? getPromotedType(leftType, rightType) : leftType ?? rightType;

        if (resultType && needsSyscall(resultType, op)) {
            const syscallName = getSyscallName(resultType, op);
            if (syscallName) {
                this.generateExpression(expr.left);
                this.emitSyscallArg(0);
                this.generateExpression(expr.right);
                this.emitSyscallArg(1);
                this.emitSyscallByName(syscallName);
                return;
            }
        }

        this.generateExpression(expr.left);
        this.emitSecondOperand(expr.right);
        this.emitter.emitByte(opInfo.opcodeWord);
    }

    private emitSecondOperand(expr: AST.Expression): void {
        if (expr.kind === 'BooleanLiteral') {
            this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
            this.emitter.emitByte(expr.value ? 1 : 0);
            return;
        }
        if (expr.kind === 'IntegerLiteral' || expr.kind === 'HexLiteral' || expr.kind === 'BinLiteral') {
            const value = expr.value;
            if (value >= -128 && value <= 127) {
                this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
                this.emitter.emitByte(value & 0xFF);
            } else if (value >= 0 && value <= 255) {
                this.emitter.emitByte(OP.OPCODE_LOB8 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitByte(value & 0xFF);
            } else if (value >= -32768 && value <= 32767) {
                // SHORT type: use signed load in data32 mode (mirrors C++ GetIntConstantType + Registers.cpp)
                const op16 = this.emitter.isData32 ? OP.OPCODE_LOB16I : OP.OPCODE_LOB16;
                this.emitter.emitByte(op16 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitWord(value & 0xFFFF);
            } else if (value >= 0 && value <= 65535) {
                // WORD type: always unsigned load
                this.emitter.emitByte(OP.OPCODE_LOB16 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitWord(value & 0xFFFF);
            } else {
                this.emitter.emitByte(OP.OPCODE_LOB32 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitDword(value);
            }
            return;
        }
        if (expr.kind === 'UnaryExpr' && expr.op === AST.UnaryOp.Neg) {
            const constVal = this.evalConstantIntExpr(expr);
            if (constVal !== undefined) {
                if (constVal >= -128 && constVal <= 127) {
                    this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitByte(constVal & 0xFF);
                } else if (constVal >= 0 && constVal <= 255) {
                    this.emitter.emitByte(OP.OPCODE_LOB8 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitByte(constVal & 0xFF);
                } else if (constVal >= -32768 && constVal <= 32767) {
                    const op16 = this.emitter.isData32 ? OP.OPCODE_LOB16I : OP.OPCODE_LOB16;
                    this.emitter.emitByte(op16 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(constVal & 0xFFFF);
                } else if (constVal >= 0 && constVal <= 65535) {
                    this.emitter.emitByte(OP.OPCODE_LOB16 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(constVal & 0xFFFF);
                } else {
                    this.emitter.emitByte(OP.OPCODE_LOB32 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitDword(constVal);
                }
                return;
            }
        }
        if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym) {
                if (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter) {
                    const varSym = sym as VariableSymbol;
                    const dt = varSym.dataType;
                    if (dt) {
                        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                        const loadOp = getLoadOpcode(dt, 'B');
                        this.emitter.emitByte(loadOp | indirection);
                        this.emitVarDataAddress(varSym);
                        return;
                    }
                }
                if (sym.kind === SymbolKind.Constant) {
                    const c = sym as ConstantSymbol;
                    if (typeof c.value === 'number') {
                        const value = c.value;
                        if (value >= -128 && value <= 127) {
                            this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
                            this.emitter.emitByte(value & 0xFF);
                        } else if (value >= 0 && value <= 255) {
                            this.emitter.emitByte(OP.OPCODE_LOB8 | OP.OPCODE_IMMEDIATE);
                            this.emitter.emitByte(value & 0xFF);
                        } else if (value >= -32768 && value <= 32767) {
                            const op16 = this.emitter.isData32 ? OP.OPCODE_LOB16I : OP.OPCODE_LOB16;
                            this.emitter.emitByte(op16 | OP.OPCODE_IMMEDIATE);
                            this.emitter.emitWord(value & 0xFFFF);
                        } else {
                            this.emitter.emitByte(OP.OPCODE_LOB16 | OP.OPCODE_IMMEDIATE);
                            this.emitter.emitWord(value & 0xFFFF);
                        }
                        return;
                    }
                }
            }
        }
        if (expr.kind === 'MemberExpr' && expr.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.object.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                if (dt && isStruct(dt)) {
                    const member = dt.memberMap.get(expr.property.toLowerCase());
                    if (member) {
                        const memberAddr = (varSym.address ?? 0) + member.offset;
                        const loadOp = getLoadOpcode(member.dataType, 'B');
                        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                        this.emitter.emitByte(loadOp | indirection);
                        this.emitter.emitDataAddress(memberAddr);
                        return;
                    }
                }
            }
        }

        this.emitter.emitByte(OP.OPCODE_XCG);
        this.generateExpression(expr);
        this.emitter.emitByte(OP.OPCODE_XCG);
    }

    private evalConstantIntExpr(expr: AST.Expression): number | undefined {
        if (expr.kind === 'IntegerLiteral' || expr.kind === 'HexLiteral' || expr.kind === 'BinLiteral') {
            return (expr as AST.IntegerLiteral).value;
        }
        if (expr.kind === 'UnaryExpr' && expr.op === AST.UnaryOp.Neg) {
            const v = this.evalConstantIntExpr(expr.operand);
            return v !== undefined ? -v : undefined;
        }
        return undefined;
    }

    // ─── Comparison ─────────────────────────────────────────────────────────

    private generateComparison(expr: AST.BinaryExpr): void {
        const signed = this.emitTypedComparison(expr.left, expr.right);
        const cmpInfo = getCmpOpInfo(expr.op, signed);
        if (!cmpInfo) {
            return;
        }

        const trueLabel = this.makeLabel('cmp_true');
        const endLabel = this.makeLabel('cmp_end');

        this.emitter.emitByte(cmpInfo.trueJmp | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(trueLabel);
        this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
        this.emitter.emitByte(0);
        this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(endLabel);
        this.emitter.defineLabel(trueLabel);
        this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
        this.emitter.emitByte(1);
        this.emitter.defineLabel(endLabel);
    }

    private emitTypedComparison(left: AST.Expression, right: AST.Expression): boolean {
        const leftType = this.inferType(left);
        const rightType = this.inferType(right);

        if ((leftType && isString(leftType)) || (rightType && isString(rightType))) {
            this.emitStringCompare(left, right);
            return false;
        }

        if ((leftType && isFloat(leftType)) || (rightType && isFloat(rightType))) {
            this.generateExpression(left);
            this.emitSyscallArg(0);
            this.generateExpression(right);
            this.emitSyscallArg(1);
            this.emitSyscallByName('fcmp');
            return false;
        }

        if (!this.emitter.isData32 && (((leftType?.size ?? 0) >= 4) || ((rightType?.size ?? 0) >= 4))) {
            this.generateExpression(left);
            this.emitSyscallArg(0);
            this.generateExpression(right);
            this.emitSyscallArg(1);
            this.emitSyscallByName('lcmp');
            return relationalComparisonSigned(leftType, rightType);
        }

        this.generateExpression(left);
        this.emitSecondOperand(right);
        this.emitter.emitByte(OP.OPCODE_CMP);
        return relationalComparisonSigned(leftType, rightType);
    }

    private generateConditionJump(condition: AST.Expression, label: string, jumpIfTrue: boolean): void {
        if (condition.kind === 'ParenExpr') {
            this.generateConditionJump(condition.expression, label, jumpIfTrue);
            return;
        }
        if (condition.kind === 'BinaryExpr') {
            const op = condition.op;

            if (op === AST.BinaryOp.And) {
                if (jumpIfTrue) {
                    const skipLabel = this.makeLabel('and_skip');
                    this.generateConditionJump(condition.left, skipLabel, false);
                    this.generateConditionJump(condition.right, label, true);
                    this.emitter.defineLabel(skipLabel);
                } else {
                    this.generateConditionJump(condition.left, label, false);
                    this.generateConditionJump(condition.right, label, false);
                }
                return;
            }

            if (op === AST.BinaryOp.Or) {
                if (jumpIfTrue) {
                    this.generateConditionJump(condition.left, label, true);
                    this.generateConditionJump(condition.right, label, true);
                } else {
                    const skipLabel = this.makeLabel('or_skip');
                    this.generateConditionJump(condition.left, skipLabel, true);
                    this.generateConditionJump(condition.right, label, false);
                    this.emitter.defineLabel(skipLabel);
                }
                return;
            }

            if (isComparisonOp(op)) {
                const signed = this.emitTypedComparison(condition.left, condition.right);
                const cmpInfo = getCmpOpInfo(op, signed);
                if (cmpInfo) {
                    const jmpOp = jumpIfTrue ? cmpInfo.trueJmp : cmpInfo.falseJmp;
                    this.emitter.emitByte(jmpOp | OP.OPCODE_DIRECT);
                    this.emitter.emitLabelReference(label);
                }
                return;
            }
        }

        this.generateExpression(condition);
        this.emitter.emitByte(OP.OPCODE_LOB8I | OP.OPCODE_IMMEDIATE);
        this.emitter.emitByte(0);
        this.emitter.emitByte(OP.OPCODE_CMP);
        if (jumpIfTrue) {
            this.emitter.emitByte(OP.OPCODE_JNE | OP.OPCODE_DIRECT);
        } else {
            this.emitter.emitByte(OP.OPCODE_JE | OP.OPCODE_DIRECT);
        }
        this.emitter.emitLabelReference(label);
    }

    private emitStringCompare(left: AST.Expression, right: AST.Expression): void {
        this.emitStringOperand(left, 0);
        this.emitStringOperand(right, 1);
        this.emitSyscallByName('strcmp');
    }

    private emitStringOperand(expr: AST.Expression, argIndex: number): void {
        if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaArgAt(varSym, argIndex);
                return;
            }
        }
        if (expr.kind === 'MemberExpr' && this.tryEmitPropertyGetterDirect(expr, this.getTempStringAddr(argIndex))) {
            this.emitLeaToArg(this.getTempStringAddr(argIndex), argIndex);
            return;
        }
        if (expr.kind === 'StringLiteral') {
            // Load rdata pointer directly — strcmp is read-only, rdata format matches string format.
            // Using strload+temp would corrupt arg0 when this is the right (argIndex=1) operand.
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(argIndex);
            return;
        }
        this.generateExpression(expr);
        this.emitSyscallArg(argIndex);
    }

    /**
     * tide NumericBinaryOperator when m_nDataAddrSize == 4 (see tide/src/tbc/Operators.cpp).
     */
    private tideData32BinaryNumericResultType(lt: DataType, rt: DataType): DataType {
        const cat = (dt: DataType): 'dw' | 'lg' | 'wd' | 'sh' | 'by' => {
            if (!isPrimitive(dt)) return 'by';
            if (dt.size >= 4) return dt.signed ? 'lg' : 'dw';
            if (dt.size >= 2) return dt.signed ? 'sh' : 'wd';
            return 'by';
        };
        const a = cat(lt);
        const b = cat(rt);
        const has = (c: 'dw' | 'lg' | 'wd' | 'sh' | 'by') => a === c || b === c;
        if (has('dw')) return BUILTIN_TYPES.dword;
        if (has('lg')) return BUILTIN_TYPES.long;
        if (has('wd')) return BUILTIN_TYPES.dword;
        if (has('sh')) return BUILTIN_TYPES.long;
        if (has('by')) return BUILTIN_TYPES.dword;
        return BUILTIN_TYPES.long;
    }

    private unwrapParenExpr(e: AST.Expression): AST.Expression {
        let x = e;
        while (x.kind === 'ParenExpr') {
            x = (x as AST.ParenExpr).expression;
        }
        return x;
    }

    /**
     * Arithmetic binary result type in 32-bit data mode (word+word → dword, etc.).
     */
    private inferData32ArithmeticExprWideResult(e: AST.Expression): DataType | undefined {
        if (!this.emitter.isData32) return undefined;
        const x = this.unwrapParenExpr(e);
        if (x.kind !== 'BinaryExpr') return undefined;
        const be = x as AST.BinaryExpr;
        if (be.op === AST.BinaryOp.Add && this.isStringExpression(be)) return undefined;
        if (isComparisonOp(be.op) || be.op === AST.BinaryOp.And || be.op === AST.BinaryOp.Or) return undefined;
        if (!BINARY_OPS[be.op]) return undefined;
        const lt = this.inferType(be.left);
        const rt = this.inferType(be.right);
        if (!lt || !rt || !isIntegral(lt) || !isIntegral(rt)) return undefined;
        return this.tideData32BinaryNumericResultType(lt, rt);
    }

    /** Largest integral leaf size for a simple binary op, or the inferred type size otherwise. */
    private maxIntegralOperandSizeForStrArg(expr: AST.Expression): number | undefined {
        const x = this.unwrapParenExpr(expr);
        if (x.kind === 'BinaryExpr' && BINARY_OPS[x.op] && !isComparisonOp(x.op)
            && !(x.op === AST.BinaryOp.Add && this.isStringExpression(x))) {
            const lt = this.inferType(x.left);
            const rt = this.inferType(x.right);
            if (!lt || !rt || !isIntegral(lt) || !isIntegral(rt)) return undefined;
            return Math.max(lt.size, rt.size);
        }
        const t = this.inferType(expr);
        if (t && isIntegral(t)) return t.size;
        return undefined;
    }

    /** tmake widens byte `sys.*` (and other object) property reads for str(); struct fields stay direct. */
    private isObjectPropertyMemberForStrByteExpand(expr: AST.Expression): boolean {
        if (expr.kind !== 'MemberExpr') return false;
        const m = expr as AST.MemberExpr;
        if (m.object.kind !== 'IdentifierExpr') return false;
        const sym = this.symbols.current.lookup(m.object.name);
        return sym?.kind === SymbolKind.Object;
    }

    /**
     * tmake uses a dword scratch + reload for some str() arithmetic args (e.g. word+word), but not
     * for byte-only arithmetic (e.g. byte + byte) — see forlooparray str(z + 1).
     */
    private strSyscallArgNeedsDwordScratchTemp(argExpr: AST.Expression, paramDt: DataType): boolean {
        const wide = this.inferData32ArithmeticExprWideResult(argExpr);
        if (!wide || wide.size !== 4 || !isIntegral(paramDt) || paramDt.size >= 4) return false;
        const x = this.unwrapParenExpr(argExpr);
        if (x.kind !== 'BinaryExpr') return false;
        const be = x as AST.BinaryExpr;
        const lt = this.inferType(be.left);
        const rt = this.inferType(be.right);
        if (!lt || !rt) return false;
        if (lt.size < 2 && rt.size < 2) return false;
        return true;
    }

    // ─── Type inference helper ──────────────────────────────────────────────

    private inferType(expr: AST.Expression): DataType | undefined {
        if (expr.kind === 'StringLiteral') return BUILTIN_TYPES.byte; // placeholder
        if (expr.kind === 'IntegerLiteral' || expr.kind === 'HexLiteral' || expr.kind === 'BinLiteral') {
            const val = (expr as AST.IntegerLiteral).value ?? 0;
            if (val >= -128 && val <= 127) return BUILTIN_TYPES.char;
            if (val >= 0 && val <= 255) return BUILTIN_TYPES.byte;
            if (val >= -32768 && val <= 32767) return BUILTIN_TYPES.short;
            if (val >= 0 && val <= 65535) return BUILTIN_TYPES.word;
            return BUILTIN_TYPES.dword;
        }
        if (expr.kind === 'FloatLiteral') return BUILTIN_TYPES.real;
        if (expr.kind === 'BooleanLiteral') return BUILTIN_TYPES.boolean;
        if (expr.kind === 'BinaryExpr') {
            if (isComparisonOp(expr.op) || expr.op === AST.BinaryOp.And || expr.op === AST.BinaryOp.Or) {
                return BUILTIN_TYPES.boolean;
            }
            if (expr.op === AST.BinaryOp.Add && this.isStringExpression(expr)) {
                return { ...BUILTIN_TYPES.string };
            }
            const leftType = this.inferType(expr.left);
            const rightType = this.inferType(expr.right);
            if (leftType && rightType) {
                return getPromotedType(leftType, rightType);
            }
            return leftType ?? rightType;
        }
        if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                return (sym as VariableSymbol).dataType;
            }
            if (sym && sym.kind === SymbolKind.Constant) {
                return sym.dataType;
            }
        }
        if (expr.kind === 'CallExpr') {
            if (expr.callee.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(expr.callee.name);
                if (sym && (sym.kind === SymbolKind.Function || sym.kind === SymbolKind.Sub)) {
                    return (sym as FunctionSymbol).returnType;
                }
                if (sym && sym.kind === SymbolKind.Syscall) {
                    return (sym as SyscallSymbol).returnType;
                }
            }
            if (expr.callee.kind === 'MemberExpr' && expr.callee.object.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(expr.callee.object.name);
                if (sym && sym.kind === SymbolKind.Object) {
                    const obj = sym as ObjectSymbol;
                    const fn = obj.functions.get(expr.callee.property.toLowerCase());
                    if (fn) {
                        return fn.returnType;
                    }
                }
            }
        }
        if (expr.kind === 'MemberExpr') {
            const objProp = this.inferMemberType(expr);
            if (objProp) return objProp;
            if (expr.object.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(expr.object.name);
                if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                    const dt = (sym as VariableSymbol).dataType;
                    if (dt && isStruct(dt)) {
                        const member = dt.memberMap.get(expr.property.toLowerCase());
                        if (member) return member.dataType;
                    }
                }
            }
            return undefined;
        }
        if (expr.kind === 'IndexExpr') {
            if (expr.object.kind === 'IdentifierExpr') {
                const sym = this.symbols.current.lookup(expr.object.name);
                if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                    const dt = (sym as VariableSymbol).dataType;
                    if (dt && isArray(dt)) return (dt as ArrayDataType).elementType;
                }
            }
        }
        if (expr.kind === 'UnaryExpr') return this.inferType(expr.operand);
        if (expr.kind === 'ParenExpr') return this.inferType(expr.expression);
        return undefined;
    }

    private inferMemberType(expr: AST.MemberExpr): DataType | undefined {
        if (expr.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.object.name);
            if (sym && sym.kind === SymbolKind.Object) {
                const obj = sym as ObjectSymbol;
                const prop = obj.properties.get(expr.property.toLowerCase());
                if (prop) return prop.dataType;
            }
        }
        return undefined;
    }

    // ─── Unary ──────────────────────────────────────────────────────────────

    private generateUnary(expr: AST.UnaryExpr): void {
        this.generateExpression(expr.operand);
        const info = UNARY_OPS[expr.op];
        if (info) {
            this.emitter.emitByte(info.opcodeWord);
        }
    }

    // ─── Call ───────────────────────────────────────────────────────────────

    private generateCall(expr: AST.CallExpr): void {
        if (expr.callee.kind === 'IdentifierExpr') {
            const name = expr.callee.name;
            const sym = this.symbols.current.lookup(name);

            if (!sym) {
                this.diagnostics.error(expr.callee.loc, `Undefined function or sub: '${name}'`);
                return;
            }

            if (sym.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                this.emitSyscallWithArgs(sc.name, sc, expr.args);
                return;
            }

            if (sym.kind === SymbolKind.Function || sym.kind === SymbolKind.Sub) {
                const fn = sym as FunctionSymbol;
                if (expr.args.length !== fn.parameters.length) {
                    this.diagnostics.error(expr.callee.loc, `Too ${expr.args.length > fn.parameters.length ? 'many' : 'few'} arguments for '${name}': expected ${fn.parameters.length}, got ${expr.args.length}`);
                    return;
                }
                this.emitFunctionCall(fn, expr.args);
                if (fn.returnType && !isString(fn.returnType) && this.functionReturnPtrAddr.has(fn.name) && !this.pendingReturnTarget && !this.isStatementCall) {
                    const loadOp = getLoadOpcode(fn.returnType, 'A');
                    this.emitter.emitByte(loadOp | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(this.getTempStringAddr(0));
                }
                return;
            }

            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.checkNotDeclareOnly(varSym, expr.callee.loc);
                const dt = varSym.dataType;
                if (dt && isArray(dt)) {
                    const elementType = (dt as ArrayDataType).elementType;

                    if (expr.args.length > 0 && expr.args[0].kind === 'IntegerLiteral') {
                        const index = (expr.args[0] as AST.IntegerLiteral).value;
                        const byteOffset = 2 + index * elementType.size;
                        const loadOp = getLoadOpcode(elementType, 'A');
                        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                        this.emitter.emitByte(loadOp | indirection);
                        this.emitVarDataAddressWithOffset(varSym, byteOffset);
                    } else {
                        this.emitGotoidxLoad(varSym, expr.args, elementType);
                    }
                    return;
                }
            }
        }

        if (expr.callee.kind === 'MemberExpr') {
            this.generateMemberCall(expr.callee, expr.args);
            return;
        }

        for (const arg of expr.args) {
            this.generateExpression(arg);
        }
    }

    private generateMemberCall(member: AST.MemberExpr, args: AST.Expression[]): void {
        if (member.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(member.object.name);
            if (objSym && objSym.kind === SymbolKind.Object) {
                const obj = objSym as ObjectSymbol;
                const fn = obj.functions.get(member.property.toLowerCase());
                if (fn) {
                    this.emitSyscallWithArgs(fn.name, fn, args);
                    return;
                }
            }
        }
        for (const arg of args) {
            this.generateExpression(arg);
        }
    }

    private getFunctionReturnVar(fn: FunctionSymbol): VariableSymbol | undefined {
        return fn.localVariables.find(v => v.name.toLowerCase() === fn.name.toLowerCase());
    }

    private emitFunctionCall(fn: FunctionSymbol, args: AST.Expression[]): void {
        if (this.ctx.currentFunction) {
            this.ctx.currentFunction.callees.add(fn.name);
        }
        for (let i = 0; i < args.length && i < fn.parameters.length; i++) {
            const param = fn.parameters[i];
            const argExpr = args[i];

            if (param.isByRef) {
                if (argExpr.kind === 'StringLiteral' && param.dataType && isString(param.dataType)) {
                    const tempAddr = this.getTempStringAddr(0);
                    this.emitTempStringInit(tempAddr, argExpr.value.length);
                    this.emitLeaArg(tempAddr);
                    const rdataOff = this.emitter.addStringRData(argExpr.value);
                    this.emitRDataLoad(rdataOff);
                    this.emitSyscallArg(1);
                    this.emitSyscallByName('strload');
                    this.emitter.emitByte(OP.OPCODE_LEA);
                    this.emitter.emitDataAddress(tempAddr);
                    this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                    if (fn.isDeclare) {
                        this.emitter.emitDataAddressRef(`?A:${fn.name}:${i}`);
                    } else {
                        this.emitter.emitDataAddress(param.address ?? 0);
                    }
                    continue;
                }
                if (argExpr.kind === 'IdentifierExpr') {
                    const argSym = this.symbols.current.lookup(argExpr.name);
                    if (argSym && (argSym.kind === SymbolKind.Variable || argSym.kind === SymbolKind.Parameter)) {
                        const aVarSym = argSym as VariableSymbol;
                        this.emitter.emitByte(aVarSym.isByRef ? OP.OPCODE_LOA32 : OP.OPCODE_LEA);
                        this.emitVarDataAddress(aVarSym);
                        this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                        if (fn.isDeclare) {
                            this.emitter.emitDataAddressRef(`?A:${fn.name}:${i}`);
                        } else {
                            this.emitter.emitDataAddress(param.address ?? 0);
                        }
                        continue;
                    }
                }
                const tempAddr = this.getTempScalarAddr(0);
                this.generateExpression(argExpr);
                const byRefStoreOp = getStoreOpcode(param.dataType ?? BUILTIN_TYPES.word);
                this.emitter.emitByte(byRefStoreOp | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(tempAddr);
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitter.emitDataAddress(tempAddr);
                this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                if (fn.isDeclare) {
                    this.emitter.emitDataAddressRef(`?A:${fn.name}:${i}`);
                } else {
                    this.emitter.emitDataAddress(param.address ?? 0);
                }
                continue;
            }

            const paramDt = param.dataType;
            if (paramDt && isString(paramDt)) {
                const strType = paramDt as StringDataType;
                const paramAddr = param.address ?? 0;

                if (this.isStringExpression(argExpr) && argExpr.kind === 'BinaryExpr' && argExpr.op === AST.BinaryOp.Add) {
                    const tempAddr = this.getTempStringAddr(0);
                    this.emitStringExprToTemp(argExpr, tempAddr, true);
                    this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(strType.maxLength << 8);
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(paramAddr);
                    this.emitLeaToArg(paramAddr, 0);
                    this.emitLeaToArg(tempAddr, 1);
                    this.emitSyscallByName('strcpy');
                } else if (argExpr.kind === 'CallExpr' && this.isStringExpression(argExpr)) {
                    const tempAddr = this.getTempStringAddr(0);
                    this.emitStringCallResultToAddr(argExpr, tempAddr);
                    this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(strType.maxLength << 8);
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(paramAddr);
                    this.emitLeaToArg(paramAddr, 0);
                    this.emitLeaToArg(tempAddr, 1);
                    this.emitSyscallByName('strcpy');
                } else {
                    this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_IMMEDIATE);
                    this.emitter.emitWord(strType.maxLength << 8);
                    this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(paramAddr);

                    if (argExpr.kind === 'StringLiteral') {
                        const rdataOff = this.emitter.addStringRData(argExpr.value);
                        this.emitLeaArg(paramAddr);
                        this.emitRDataLoad(rdataOff);
                        this.emitSyscallArg(1);
                        this.emitSyscallByName('strload');
                    } else if (argExpr.kind === 'IdentifierExpr') {
                        const srcSym = this.symbols.current.lookup(argExpr.name);
                        if (srcSym && srcSym.kind === SymbolKind.Constant && typeof (srcSym as ConstantSymbol).value === 'string') {
                            const rdataOff = this.emitter.addStringRData((srcSym as ConstantSymbol).value as string);
                            this.emitLeaArg(paramAddr);
                            this.emitRDataLoad(rdataOff);
                            this.emitSyscallArg(1);
                            this.emitSyscallByName('strload');
                        } else if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                            const src = srcSym as VariableSymbol;
                            this.emitLeaArg(paramAddr);
                            this.emitVarLeaArgAt(src, 1);
                            this.emitSyscallByName('strcpy');
                        }
                    } else {
                        this.generateStringAssignment({ address: paramAddr, dataType: paramDt, kind: SymbolKind.Variable, isByRef: false, isGlobal: false, name: '', scope: '' } as unknown as VariableSymbol, argExpr);
                    }
                }
                continue;
            }

            const effectiveDt = paramDt ?? BUILTIN_TYPES.word;
            this.generateExpression(argExpr);
            if (argExpr.kind === 'BinaryExpr') {
                const tempAddr = this.getTempStringAddr(0);
                this.emitter.emitByte(getStoreOpcode(effectiveDt) | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(tempAddr);
                this.emitter.emitByte(getLoadOpcode(effectiveDt, 'A') | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(tempAddr);
            }
            this.emitter.emitByte(getStoreOpcode(effectiveDt) | OP.OPCODE_DIRECT);
            if (fn.isDeclare) {
                this.emitter.emitDataAddressRef(`?A:${fn.name}:${i}`);
            } else {
                this.emitter.emitDataAddress(param.address ?? 0);
            }
        }

        const retPtrAddr = this.functionReturnPtrAddr.get(fn.name);
        if (retPtrAddr !== undefined) {
            let targetAddr: number;
            if (this.pendingReturnTarget) {
                targetAddr = this.pendingReturnTarget;
            } else {
                // Count string temp slots consumed by this call's arguments.
                // If any args use slot 0 for string temporaries, the return target
                // must go at slot 1 to avoid overwriting those temporaries.
                let argStringTemps = 0;
                for (let ai = 0; ai < args.length && ai < fn.parameters.length; ai++) {
                    const p = fn.parameters[ai];
                    const a = args[ai];
                    if ((p.isByRef || (p.dataType && isString(p.dataType))) && a.kind !== 'IdentifierExpr') {
                        argStringTemps++;
                    }
                }
                const returnSlot = Math.min(argStringTemps, 1);
                targetAddr = this.getTempStringAddr(returnSlot);
            }
            if (fn.returnType && isString(fn.returnType) && !this.pendingReturnTarget) {
                this.emitTempStringInit(targetAddr);
            }
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddress(targetAddr);
            this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
            this.emitter.emitDataAddress(retPtrAddr);
        }
        this.emitter.emitByte(OP.OPCODE_CALL | OP.OPCODE_DIRECT);
        this.emitter.emitLabelReference(fn.name);
    }

    // ─── Member expression ──────────────────────────────────────────────────

    private tryEmitPropertyGetterDirect(expr: AST.Expression, destAddr: number): boolean {
        if (expr.kind !== 'MemberExpr') return false;
        const member = expr as AST.MemberExpr;
        if (member.object.kind !== 'IdentifierExpr') return false;
        const sym = this.symbols.current.lookup(member.object.name);
        if (!sym || sym.kind !== SymbolKind.Object) return false;
        const obj = sym as ObjectSymbol;
        const prop = obj.properties.get(member.property.toLowerCase());
        if (!prop || prop.getterSyscall === undefined) return false;

        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitter.emitDataAddress(destAddr);
        this.emitSyscallArg(0);
        this.emitSyscall(prop.getterSyscall);
        return true;
    }

    private generateMember(expr: AST.MemberExpr): void {
        if (expr.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.object.name);
            if (sym && sym.kind === SymbolKind.Object) {
                const obj = sym as ObjectSymbol;
                const prop = obj.properties.get(expr.property.toLowerCase());
                if (prop) {
                    const getNum = prop.getterSyscall;
                    if (getNum !== undefined) {
                        const tempAddr = this.getTempScalarAddr(0);
                        this.emitter.emitByte(OP.OPCODE_LEA);
                        this.emitter.emitDataAddress(tempAddr);
                        this.emitSyscallArg(0);
                        this.emitSyscall(getNum);
                        const dt = prop.dataType;
                        const loadOp = getLoadOpcode(dt ?? BUILTIN_TYPES.word, 'A');
                        this.emitter.emitByte(loadOp | OP.OPCODE_DIRECT);
                        this.emitter.emitDataAddress(tempAddr);
                    }
                    return;
                }
            }
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                if (dt && isStruct(dt)) {
                    const member = dt.memberMap.get(expr.property.toLowerCase());
                    if (member) {
                        const baseAddr = varSym.address ?? 0;
                        const memberAddr = baseAddr + member.offset;
                        const loadOp = getLoadOpcode(member.dataType, 'A');
                        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                        this.emitter.emitByte(loadOp | indirection);
                        this.emitter.emitDataAddress(memberAddr);
                        return;
                    }
                }
            }
            if (sym && sym.kind === SymbolKind.Enum) {
                const enumDt = sym.dataType;
                if (enumDt && isEnum(enumDt)) {
                    const member = enumDt.memberMap.get(expr.property.toLowerCase());
                    if (member) {
                        this.generateIntLiteral(Number(member.value));
                        return;
                    }
                }
            }
        }
    }

    // ─── gotoidx helpers ────────────────────────────────────────────────────

    private emitGotoidxArgs(varSym: VariableSymbol, indices: AST.Expression[]): number {
        // arg[0..3]: byref obj (array base address)
        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitVarDataAddress(varSym);
        this.emitStoreToArgBuffer(0, 4);

        // arg[4]: count as byte (number of dimensions)
        this.generateIntLiteral(indices.length);
        this.emitStoreToArgBuffer(4, 1);

        // arg[5..]: indices as word (i1, i2, ...)
        let offset = 5;
        for (const idx of indices) {
            this.generateExpression(idx);
            this.emitStoreToArgBuffer(offset, 2);
            offset += 2;
        }

        // return value pointer at offset 21 (after all 8 possible word indices)
        const localBase = this.platformSize + Math.max(this.globalDataOffset, this.projectGlobalAllocSize) + this.stackSize;
        const fn = this.ctx.currentFunction;
        const tempAddr = fn?.name.startsWith('on_')
            ? localBase + this.onEventDeclaredLocalBytes
            : localBase + (fn?.localAllocSize ?? 0);
        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitter.emitDataAddress(tempAddr);
        this.emitStoreToArgBuffer(21, 4);

        this.emitSyscallByName('gotoidx');
        return tempAddr;
    }

    private emitGotoidxStore(
        varSym: VariableSymbol, indices: AST.Expression[],
        elementType: DataType, value: AST.Expression,
    ): void {
        const tempAddr = this.emitGotoidxArgs(varSym, indices);
        this.generateExpression(value);
        this.emitter.emitByte(getStoreOpcode(elementType) | OP.OPCODE_INDIRECT);
        this.emitter.emitDataAddress(tempAddr);
    }

    private emitGotoidxLoad(
        varSym: VariableSymbol, indices: AST.Expression[],
        elementType: DataType,
    ): void {
        const tempAddr = this.emitGotoidxArgs(varSym, indices);
        this.emitter.emitByte(getLoadOpcode(elementType, 'A') | OP.OPCODE_INDIRECT);
        this.emitter.emitDataAddress(tempAddr);
    }

    // ─── Index expression ───────────────────────────────────────────────────

    private generateIndex(expr: AST.IndexExpr): void {
        if (expr.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.object.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                if (dt && isArray(dt)) {
                    const elementType = (dt as ArrayDataType).elementType;
                    if (expr.indices.length > 0 && expr.indices[0].kind === 'IntegerLiteral') {
                        const index = (expr.indices[0] as AST.IntegerLiteral).value;
                        const byteOffset = 2 + index * elementType.size;
                        const loadOp = getLoadOpcode(elementType, 'A');
                        const indirection = varSym.isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
                        this.emitter.emitByte(loadOp | indirection);
                        this.emitVarDataAddressWithOffset(varSym, byteOffset);
                    } else {
                        this.emitGotoidxLoad(varSym, expr.indices, elementType);
                    }
                    return;
                }
            }
        }
        if (expr.object.kind === 'MemberExpr') {
            this.generateMember(expr.object);
        }
    }

    private generateIndexAssignment(target: AST.IndexExpr, value: AST.Expression): void {
        if (target.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(target.object.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                const elementType = (dt && isArray(dt)) ? (dt as ArrayDataType).elementType : undefined;

                if (elementType && isString(elementType)) {
                    this.emitter.emitByte(OP.OPCODE_LEA);
                    this.emitVarDataAddress(varSym);
                    this.emitSyscallArg(0);

                    if (target.indices.length > 0) {
                        this.generateExpression(target.indices[0]);
                        this.emitSyscallArg(1);
                    }

                    this.emitSyscallByName('gotoidx');

                    this.emitSyscallArg(0);
                    if (value.kind === 'StringLiteral') {
                        const rdataOff = this.emitter.addStringRData((value as AST.StringLiteral).value);
                        this.emitRDataLoad(rdataOff);
                        this.emitSyscallArg(1);
                        this.emitSyscallByName('strload');
                    } else if (value.kind === 'IdentifierExpr') {
                        const srcSym = this.symbols.current.lookup((value as AST.IdentifierExpr).name);
                        if (srcSym && srcSym.kind === SymbolKind.Constant && typeof (srcSym as ConstantSymbol).value === 'string') {
                            const rdataOff = this.emitter.addStringRData((srcSym as ConstantSymbol).value as string);
                            this.emitRDataLoad(rdataOff);
                            this.emitSyscallArg(1);
                            this.emitSyscallByName('strload');
                        } else if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                            const src = srcSym as VariableSymbol;
                            if (src.dataType && isString(src.dataType)) {
                                this.emitVarLeaArgAt(src, 1);
                                this.emitSyscallByName('strcpy');
                            }
                        }
                    }
                    return;
                }

                if (elementType) {
                    this.emitGotoidxStore(varSym, target.indices, elementType, value);
                    return;
                }
            }
        }
        this.generateExpression(value);
    }
}

function isComparisonOp(op: AST.BinaryOp): boolean {
    return op === AST.BinaryOp.Eq || op === AST.BinaryOp.Neq ||
        op === AST.BinaryOp.Lt || op === AST.BinaryOp.Gt ||
        op === AST.BinaryOp.Leq || op === AST.BinaryOp.Geq;
}
