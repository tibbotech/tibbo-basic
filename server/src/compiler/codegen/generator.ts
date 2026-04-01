import * as AST from '../ast/nodes';
import * as OP from './opcodes';
import { ByteEmitter } from './emitter';
import { DiagnosticCollection } from '../errors';
import { SymbolTable, SymbolKind, VariableSymbol, FunctionSymbol, SyscallSymbol, ObjectSymbol, PropertySymbol, ConstantSymbol } from '../semantics/symbols';
import { SemanticResolver } from '../semantics/resolver';
import { TypeChecker } from '../semantics/checker';
import {
    DataType, isString, isFloat, isNumeric, isEnum, isStruct, isArray,
    StringDataType, EnumDataType, StructDataType, ArrayDataType, getPromotedType, BUILTIN_TYPES,
} from '../semantics/types';
import { BINARY_OPS, CMP_OPS, CMP_OPS_SIGNED, CMP_OPS_UNSIGNED, UNARY_OPS, getLoadOpcode, getStoreOpcode, getCmpOpInfo, needsSyscall, getSyscallName } from './operators';
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
    private static readonly TEMP_STRING_SLOT_COUNT = 4;
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

    private onEventScratchSkip(): number {
        const fn = this.ctx.currentFunction;
        if (!fn?.name.startsWith('on_')) return 0;
        return this.onEventDeclaredLocalBytes;
    }

    private getTempStringAddr(slot = 0): number {
        const fn = this.ctx.currentFunction;
        if (fn) {
            const fnBase = this.functionTempBase.get(fn.name);
            if (fnBase !== undefined) {
                return fnBase + slot * PCodeGenerator.TEMP_STRING_SLOT_SIZE;
            }
        }
        const skip = this.onEventScratchSkip();
        return this.tempScratchBase + skip + slot * PCodeGenerator.TEMP_STRING_SLOT_SIZE;
    }

    private getTempScalarAddr(slot = 0): number {
        const skip = this.onEventScratchSkip();
        return this.tempScratchBase + skip
            + PCodeGenerator.TEMP_STRING_SLOT_COUNT * PCodeGenerator.TEMP_STRING_SLOT_SIZE
            + slot * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
    }

    private isFromCurrentFile(decl: AST.TopLevelDeclaration): boolean {
        if (this.headerLineCount <= 0) return true;
        return decl.loc.line > this.headerLineCount;
    }

    generate(program: AST.Program): void {
        this.buildSyscallMap();
        this.allocateGlobalVariables(program);
        this.buildCallGraph(program);
        this.stackSize = this.computeStackSize();
        this.allocateFunctionFrames(program);

        const localBase = this.platformSize + this.globalDataOffset + this.stackSize;
        this.includeTempsInLocalAllocSize(program);
        this.tempScratchBase = localBase + this.localAllocSize;
        this.localAllocSize += this.rootTempScratchSize;

        const maxRootArea = this.computeMaxRootArea(program);
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

        for (const decl of program.declarations) {
            if (!this.isFromCurrentFile(decl)) continue;
            switch (decl.kind) {
                case 'SubDecl': this.generateSub(decl); break;
                case 'FunctionDecl': this.generateFunction(decl); break;
            }
        }

        this.emitter.resolveLabels();
    }

    /**
     * Tibbo pools string literals from the entire expanded translation unit (headers + file)
     * in source order. We only emit bytecode for decls after headerLineCount, so without this
     * pass RData omits header-only literals and every later string sits at the wrong offset.
     */
    private preallocateStringPoolFromAst(program: AST.Program): void {
        const hits: { s: string; line: number; col: number }[] = [];

        const visit = (node: unknown): void => {
            if (node === null || node === undefined) return;
            if (typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            if (n.kind === 'StringLiteral') {
                const sl = n as unknown as AST.StringLiteral;
                hits.push({
                    s: sl.value,
                    line: sl.loc?.line ?? 0,
                    col: sl.loc?.column ?? 0,
                });
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
        this.emitSyscallArgsOnly(sym, args, 0);
        this.emitSyscall(sym.syscallNumber);
    }

    private emitSyscallArgsOnly(sym: SyscallSymbol, args: AST.Expression[], startOffset: number): number {
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
                if (argExpr.kind === 'MemberExpr') {
                    this.generateMember(argExpr);
                    this.emitStoreToArgBuffer(offset, storeSize);
                } else {
                    this.generateExpression(argExpr);
                    this.emitStoreToArgBuffer(offset, storeSize);
                }
                offset += storeSize;
            }
        }
        return offset;
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
                    this.emitTempStringInit(addr);
                    let nextOffset: number;
                    const preEvalAddr = this.preEvalMap.get(expr);
                    if (preEvalAddr !== undefined) {
                        this.emitter.emitByte(OP.OPCODE_LOA32);
                        this.emitter.emitDataAddress(preEvalAddr);
                        const storeSize = this.getSyscallParamStoreSize(sc.parameters[0]);
                        this.emitStoreToArgBuffer(0, storeSize);
                        nextOffset = storeSize;
                    } else {
                        nextOffset = this.emitSyscallArgsOnly(sc, expr.args, 0);
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
                    const nextOffset = this.emitSyscallArgsOnly(fn, expr.args, 0);
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
            const scalarBase = tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE;
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
        } else if (expr.kind === 'MemberExpr' && this.tryEmitPropertyGetterDirect(expr, tempAddr)) {
            this.emitLeaToArgOffset(tempAddr, argOffset);
            return;
        } else if (expr.kind === 'CallExpr' && this.emitStringCallResultToAddr(expr, tempAddr)) {
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
            const sourceAddr = isFirst ? tempAddr : tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE + this.preEvalMap.size * 4;
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
                const litAddr = tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE + this.preEvalMap.size * 4;
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
            const callResultAddr = tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE + this.preEvalMap.size * 4;
            if (this.emitStringCallResultToAddr(expr, callResultAddr)) {
                this.emitLeaToArg(tempAddr, 0);
                this.emitLeaToArg(callResultAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
        }

        if (expr.kind === 'StringLiteral') {
            const litAddr = tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE + this.preEvalMap.size * 4;
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
            const sourceAddr = tempAddr + PCodeGenerator.TEMP_STRING_SLOT_SIZE + this.preEvalMap.size * 4;
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
        const localBase = this.platformSize + this.globalDataOffset + this.stackSize;

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
            if (name.startsWith('on_') && !calledFunctions.has(name)) {
                computeLive(name);
            }
        }

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            if (calledFunctions.has(decl.name)) continue;
            const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!sym) continue;

            let offset = 0;
            let ordinal = 1;
            for (let pi = 0; pi < sym.parameters.length; pi++) {
                const v = sym.parameters[pi];
                v.address = localBase + offset;
                const labelName = `?A:${sym.name}:${pi}`;
                this.localVarLabelMap.set(v, labelName);
                this.emitter.defineDataLabel(labelName, v.address);
                ordinal++;
                offset += v.isByRef ? 4 : (v.dataType?.size ?? 2);
            }

            if (!decl.name.startsWith('on_')) {
                this.allocateDeadChainInRootArea(decl.name, localBase, offset);
            }

            for (const v of sym.localVariables) {
                v.address = localBase + offset;
                offset += v.dataType?.size ?? 2;
            }
            sym.localAllocSize = offset;
            if (offset > this.localAllocSize) {
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
            for (const v of sym.localVariables) {
                rootArea += v.dataType?.size ?? 2;
            }

            const perStmt = this.countTempVarsPerStatement(decl.body);
            let maxSlots = 0;
            for (const n of perStmt) {
                const concurrent = n >= 2 ? 2 : n;
                if (concurrent > maxSlots) maxSlots = concurrent;
            }
            const scalarCount = this.countFunctionPreEvalScalars(decl);
            rootArea += maxSlots * PCodeGenerator.TEMP_STRING_SLOT_SIZE + scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

            if (rootArea > maxRootArea) maxRootArea = rootArea;
        }
        return maxRootArea;
    }

    private allocateCalledFunctionParams(program: AST.Program, maxRootArea: number): void {
        const localBase = this.platformSize + this.globalDataOffset + this.stackSize;
        const paramBase = localBase + maxRootArea;

        const calledFunctions = new Set<string>();
        for (const calls of this.callGraph.values()) {
            for (const c of calls) calledFunctions.add(c);
        }

        const ordered = this.getCallChainOrder(calledFunctions);

        let liveParamOffset = 0;
        let deadParamTotal = 0;

        for (const fnName of ordered) {
            const sym = this.symbols.lookupGlobal(fnName) as FunctionSymbol | undefined;
            if (!sym) continue;

            const isLive = this.liveReachable.has(fnName);
            const isFuncWithReturn = sym.kind === SymbolKind.Function && !!sym.returnType;

            if (isLive) {
                for (let i = 0; i < sym.parameters.length; i++) {
                    const v = sym.parameters[i];
                    v.address = paramBase + liveParamOffset;
                    if (this.resolveDataAddresses) {
                        const labelName = `?A:${sym.name}:${i}`;
                        this.localVarLabelMap.set(v, labelName);
                        this.emitter.defineDataLabel(labelName, v.address);
                    }
                    liveParamOffset += v.isByRef ? 4 : (v.dataType?.size ?? 2);
                }
                if (isFuncWithReturn) {
                    const retPtrAddr = paramBase + liveParamOffset;
                    this.functionReturnPtrAddr.set(fnName, retPtrAddr);
                    liveParamOffset += 4;

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
            } else {
                for (const p of sym.parameters) {
                    deadParamTotal += p.isByRef ? 4 : (p.dataType?.size ?? 2);
                }
                if (isFuncWithReturn) {
                    deadParamTotal += 4;
                }
            }

            const hasCallees = (this.callGraph.get(fnName)?.size ?? 0) > 0;

            let localOffset = 0;
            if (isLive) {
                for (const v of sym.localVariables) {
                    if (isFuncWithReturn && v.name.toLowerCase() === sym.name.toLowerCase()) {
                        continue;
                    }
                    v.address = paramBase + liveParamOffset + localOffset;
                    localOffset += v.dataType?.size ?? 2;
                }
            } else {
                for (const v of sym.localVariables) {
                    if (isFuncWithReturn && v.name.toLowerCase() === sym.name.toLowerCase()) {
                        continue;
                    }
                    localOffset += v.dataType?.size ?? 2;
                }
            }

            if (isLive) {
                liveParamOffset += localOffset;
            } else {
                deadParamTotal += localOffset;
            }

            if (isLive) {
                const decl = program.declarations.find(d =>
                    (d.kind === 'SubDecl' || d.kind === 'FunctionDecl') && d.name.toLowerCase() === fnName.toLowerCase()
                );
                if (decl && (decl.kind === 'SubDecl' || decl.kind === 'FunctionDecl')) {
                    // Must match registerTempVariables: same perStmt / maxSlots / scalarCount as full body.
                    const perStmtTail = this.countTempVarsPerStatement(decl.body);
                    let maxSlotsTail = 0;
                    for (const n of perStmtTail) {
                        const concurrent = n >= 2 ? 2 : n;
                        if (concurrent > maxSlotsTail) maxSlotsTail = concurrent;
                    }
                    const scalarCountTail = this.countFunctionPreEvalScalars(decl);
                    const tailTempSize =
                        maxSlotsTail * PCodeGenerator.TEMP_STRING_SLOT_SIZE +
                        scalarCountTail * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;
                    if (tailTempSize > 0) {
                        const tempBase = paramBase + liveParamOffset;
                        this.functionTempBase.set(fnName, tempBase);
                        liveParamOffset += tailTempSize;
                    }
                }
            }
        }
        const chainSize = maxRootArea + liveParamOffset + deadParamTotal;
        if (chainSize > this.localAllocSize) {
            this.localAllocSize = chainSize;
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
            const tempFootprint = maxSlots * PCodeGenerator.TEMP_STRING_SLOT_SIZE
                + scalarCount * PCodeGenerator.TEMP_SCALAR_SLOT_SIZE;

            frameSizes.set(decl.name, declaredSize + tempFootprint);
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
            const ext = this.eventFramePrefixBytes(fn) + tempFp;
            if (ext > maxRootTempExt) maxRootTempExt = ext;
        }
        this.rootTempScratchSize = maxRootTempExt;

        const getChainSize = (name: string, counted: Set<string>): number => {
            if (counted.has(name)) return 0;
            counted.add(name);
            const ownSize = frameSizes.get(name) ?? 0;
            const calls = this.callGraph.get(name);
            let calleeTotal = 0;
            if (calls) {
                for (const c of calls) {
                    calleeTotal += getChainSize(c, counted);
                }
            }
            return ownSize + calleeTotal;
        };

        for (const [name] of frameSizes) {
            if (calledFunctions.has(name)) continue;
            const chainTotal = getChainSize(name, new Set<string>());
            if (chainTotal > this.localAllocSize) {
                this.localAllocSize = chainTotal;
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
            const tempBase = fnTempBase ?? this.tempScratchBase + this.eventFramePrefixBytes(fn);

            if (total > 0) {
                const slotAssignments: number[] = [];
                for (const stmtCount of perStmt) {
                    for (let s = 0; s < stmtCount; s++) {
                        slotAssignments.push(Math.min(s, 1));
                    }
                }

                const slot1Offset = PCodeGenerator.TEMP_STRING_SLOT_SIZE +
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
                const scalarAddr = tempBase + PCodeGenerator.TEMP_STRING_SLOT_SIZE;
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
                    this.emitter.emitByte(OP.OPCODE_LOA16 | OP.OPCODE_IMMEDIATE);
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
        if (sym.name.startsWith('on_')) {
            for (const par of sym.parameters) {
                this.onEventDeclaredLocalBytes += par.isByRef ? 4 : (par.dataType?.size ?? 2);
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
        if (sym.name.startsWith('on_')) {
            for (const par of sym.parameters) {
                this.onEventDeclaredLocalBytes += par.isByRef ? 4 : (par.dataType?.size ?? 2);
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
            this.generateCall(expr);
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
                    this.emitSyscallArg(0);
                    if (setNum !== undefined) {
                        this.emitSyscall(setNum);
                    }
                    return;
                }
                const fn = obj.functions.get(target.property.toLowerCase());
                if (fn) {
                    this.generateExpression(value);
                    this.emitSyscallArg(0);
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
            this.generateStringAssignment(varSym, value.left);
            this.emitStringCat(varSym, value.right);
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

        this.emitVarLeaArg(destSym);
        if (expr.kind === 'StringLiteral') {
            const rdataOffset = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOffset);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strload');
            this.emitVarLeaArg(destSym);
        }
        if (expr.kind === 'IdentifierExpr') {
            const srcSym = this.symbols.current.lookup(expr.name);
            if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                const src = srcSym as VariableSymbol;
                this.emitVarLeaArgAt(src, 1);
            }
        } else if (expr.kind === 'CallExpr' && this.emitStringCallResultToAddr(expr, this.getTempStringAddr(0))) {
            this.emitLeaToArg(this.getTempStringAddr(0), 1);
        } else if (expr.kind !== 'StringLiteral') {
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
        this.generateBlock(stmt.thenBody);

        if (stmt.elseIfBranches.length > 0 || stmt.elseBody) {
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
        }
        this.emitter.defineLabel(elseLabel);

        for (let i = 0; i < stmt.elseIfBranches.length; i++) {
            const branch = stmt.elseIfBranches[i];
            const nextLabel = (i < stmt.elseIfBranches.length - 1 || stmt.elseBody) ? this.makeLabel('elseif') : endLabel;
            this.generateConditionJump(branch.condition, nextLabel, false);
            this.generateBlock(branch.body);
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
            this.emitter.defineLabel(nextLabel);
        }

        if (stmt.elseBody) {
            this.generateBlock(stmt.elseBody);
        }

        this.emitter.defineLabel(endLabel);
    }

    // ─── Select Case ────────────────────────────────────────────────────────

    private generateSelectCase(stmt: AST.SelectCaseStmt): void {
        const endLabel = this.makeLabel('select_end');

        for (let i = 0; i < stmt.cases.length; i++) {
            const c = stmt.cases[i];
            const caseBodyLabel = this.makeLabel('case_body');
            const nextLabel = this.makeLabel('case_next');

            for (const cond of c.conditions) {
                this.emitTypedComparison(stmt.testExpr, cond);
                this.emitter.emitByte(OP.OPCODE_JE | OP.OPCODE_DIRECT);
                this.emitter.emitLabelReference(caseBodyLabel);
            }

            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(nextLabel);
            this.emitter.defineLabel(caseBodyLabel);
            this.generateBlock(c.body);
            this.emitter.emitByte(OP.OPCODE_JMP | OP.OPCODE_DIRECT);
            this.emitter.emitLabelReference(endLabel);
            this.emitter.defineLabel(nextLabel);
        }

        if (stmt.defaultCase) {
            this.generateBlock(stmt.defaultCase);
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
                this.generateExpression(stmt.to);
                this.emitter.emitByte(OP.OPCODE_XCG);
                this.emitLoad(counterSym as VariableSymbol);
                this.emitter.emitByte(OP.OPCODE_CMP);
                this.emitter.emitByte(OP.OPCODE_JG | OP.OPCODE_DIRECT);
                this.emitter.emitLabelReference(endLabel);
            }
        }

        this.generateBlock(stmt.body);

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
        this.generateBlock(stmt.body);
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

        this.generateBlock(stmt.body);

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
                const strType = dt as StringDataType;
                this.emitter.emitByte(OP.OPCODE_LOA16I | OP.OPCODE_IMMEDIATE);
                this.emitter.emitWord(strType.maxLength << 8);
                this.emitter.emitByte(OP.OPCODE_STO16 | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(addr);
            }

            if (dt && (isStruct(dt) || isArray(dt))) {
                this.emitInitObjAtAddr(addr, varSym.isByRef, dt);
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
                } else if (this.tryEmitPropertyGetterDirect(stmt.initializer, addr)) {
                    // Property getter stores directly to local var
                } else {
                    this.generateExpression(stmt.initializer);
                    this.emitStore(varSym);
                }
            }

            if (stmt.arrayInitializer && dt && isArray(dt)) {
                this.emitArrayInitializer(addr, dt, stmt.arrayInitializer, varSym.isByRef);
            }

            if (this.ctx.currentFunction?.name.startsWith('on_') && !varSym.isTemp) {
                this.onEventDeclaredLocalBytes += varSym.dataType?.size ?? 2;
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
            } else if (value >= -32768 && value <= 65535) {
                this.emitter.emitByte(OP.OPCODE_LOB16 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitWord(value & 0xFFFF);
            } else {
                this.emitter.emitByte(OP.OPCODE_LOB32 | OP.OPCODE_IMMEDIATE);
                this.emitter.emitDword(value);
            }
            return;
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
                        } else {
                            this.emitter.emitByte(OP.OPCODE_LOB16 | OP.OPCODE_IMMEDIATE);
                            this.emitter.emitWord(value & 0xFFFF);
                        }
                        return;
                    }
                }
            }
        }

        this.emitter.emitByte(OP.OPCODE_XCG);
        this.generateExpression(expr);
        this.emitter.emitByte(OP.OPCODE_XCG);
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
            return (leftType?.signed || rightType?.signed) ?? false;
        }

        this.generateExpression(left);
        this.emitSecondOperand(right);
        this.emitter.emitByte(OP.OPCODE_CMP);
        return (leftType?.signed || rightType?.signed) ?? false;
    }

    private generateConditionJump(condition: AST.Expression, label: string, jumpIfTrue: boolean): void {
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
            return this.inferMemberType(expr);
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
                this.emitFunctionCall(fn, expr.args);
                if (fn.returnType && !isString(fn.returnType) && this.functionReturnPtrAddr.has(fn.name)) {
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
                    } else if (argExpr.kind === 'CallExpr' && this.isStringExpression(argExpr)) {
                        this.emitStringCallResultToAddr(argExpr, paramAddr);
                    } else {
                        this.generateStringAssignment({ address: paramAddr, dataType: paramDt, kind: SymbolKind.Variable, isByRef: false, isGlobal: false, name: '', scope: '' } as unknown as VariableSymbol, argExpr);
                    }
                }
                continue;
            }

            this.generateExpression(argExpr);
            const storeOp = getStoreOpcode(paramDt ?? BUILTIN_TYPES.word);
            this.emitter.emitByte(storeOp | OP.OPCODE_DIRECT);
            if (fn.isDeclare) {
                this.emitter.emitDataAddressRef(`?A:${fn.name}:${i}`);
            } else {
                this.emitter.emitDataAddress(param.address ?? 0);
            }
        }

        const retPtrAddr = this.functionReturnPtrAddr.get(fn.name);
        if (retPtrAddr !== undefined) {
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddress(this.getTempStringAddr(0));
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
        const localBase = this.platformSize + this.globalDataOffset + this.stackSize;
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
