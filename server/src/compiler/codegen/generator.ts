import * as AST from '../ast/nodes';
import * as OP from './opcodes';
import { ByteEmitter } from './emitter';
import { DiagnosticCollection } from '../errors';
import { SymbolTable, SymbolKind, VariableSymbol, FunctionSymbol, SyscallSymbol, ObjectSymbol, PropertySymbol, ConstantSymbol } from '../semantics/symbols';
import { SemanticResolver } from '../semantics/resolver';
import { TypeChecker } from '../semantics/checker';
import {
    DataType, isString, isFloat, isNumeric, isEnum, isStruct, isArray,
    StringDataType, EnumDataType, StructDataType, getPromotedType, BUILTIN_TYPES,
} from '../semantics/types';
import { BINARY_OPS, CMP_OPS, CMP_OPS_SIGNED, CMP_OPS_UNSIGNED, UNARY_OPS, getLoadOpcode, getStoreOpcode, getCmpOpInfo, needsSyscall, getSyscallName } from './operators';

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
    private static readonly TEMP_STRING_SLOT_SIZE = 260;
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
    private headerLineCount = 0;
    private tempScratchBase = 0;

    constructor(symbols: SymbolTable, resolver: SemanticResolver, checker: TypeChecker, diagnostics: DiagnosticCollection) {
        this.symbols = symbols;
        this.resolver = resolver;
        this.checker = checker;
        this.diagnostics = diagnostics;
    }

    setPlatformSize(size: number): void {
        this.platformSize = size;
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

    private getTempStringAddr(slot = 0): number {
        return this.tempScratchBase + slot * PCodeGenerator.TEMP_STRING_SLOT_SIZE;
    }

    private getTempScalarAddr(slot = 0): number {
        return this.tempScratchBase
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
        this.allocateFunctionFrames(program);

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
                    this.syscallMap.set(fn.name.toLowerCase(), fn.syscallNumber);
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
        const indirection = isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        this.emitter.emitByte(OP.OPCODE_LEA | indirection);
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

    private emitVarDataAddress(sym: VariableSymbol): void {
        if (sym.isGlobal) {
            this.emitter.emitDataAddressRef(`?V:${sym.name}`);
        } else {
            this.emitter.emitDataAddress(sym.address ?? 0);
        }
    }

    private emitVarLeaArg(sym: VariableSymbol): void {
        this.emitVarLeaArgAt(sym, 0);
    }

    private emitVarLeaArgAt(sym: VariableSymbol, argIndex: number): void {
        if (sym.isGlobal) {
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddressRef(`?V:${sym.name}`);
            this.emitSyscallArg(argIndex);
        } else {
            this.emitLeaToArg(sym.address ?? 0, argIndex, sym.isByRef);
            return;
        }
    }

    private emitInitObjAtAddr(addr: number, isByRef = false): void {
        const indirection = isByRef ? OP.OPCODE_INDIRECT : OP.OPCODE_DIRECT;
        this.emitter.emitByte(OP.OPCODE_LEA | indirection);
        this.emitter.emitDataAddress(addr);
        this.emitSyscallArg(0);
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
        this.emitter.emitDword(0);
        this.emitSyscallArg(1);
        this.emitSyscallByName('initobj');
    }

    private emitInitObj(sym: VariableSymbol): void {
        if (sym.isGlobal) {
            this.emitVarLeaArg(sym);
        } else {
            this.emitInitObjAtAddr(sym.address ?? 0, sym.isByRef);
            return;
        }
        this.emitter.emitByte(OP.OPCODE_LOA32 | OP.OPCODE_IMMEDIATE);
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

    private emitSyscallWithArgs(syscallName: string, sym: SyscallSymbol, args: AST.Expression[], startArgIndex = 0): void {
        const params = sym.parameters;
        for (let i = 0; i < args.length && i < params.length; i++) {
            const param = params[i];
            const argExpr = args[i];
            const paramDt = param.dataType;
            const argIndex = startArgIndex + i;

            if (param.isByRef || (paramDt && isString(paramDt))) {
                if (argExpr.kind === 'IdentifierExpr') {
                    const argSym = this.symbols.current.lookup(argExpr.name);
                    if (argSym && (argSym.kind === SymbolKind.Variable || argSym.kind === SymbolKind.Parameter)) {
                        const varSym = argSym as VariableSymbol;
                        this.emitter.emitByte(OP.OPCODE_LEA);
                        this.emitVarDataAddress(varSym);
                        this.emitSyscallArg(argIndex);
                        continue;
                    }
                }
                if (paramDt && isString(paramDt) && argExpr.kind === 'StringLiteral') {
                    const rdataOff = this.emitter.addStringRData(argExpr.value);
                    this.emitRDataLoad(rdataOff);
                    this.emitSyscallArg(argIndex);
                    continue;
                }
                if (paramDt && isString(paramDt) && this.isStringExpression(argExpr)) {
                    this.emitStringExprToArg(argExpr, argIndex);
                    continue;
                }
                if (argExpr.kind === 'MemberExpr') {
                    if (paramDt && isString(paramDt) && this.tryEmitPropertyGetterDirect(argExpr, this.getTempStringAddr(0))) {
                        this.emitLeaToArg(this.getTempStringAddr(0), argIndex);
                        continue;
                    }
                    this.emitter.emitByte(OP.OPCODE_LEA);
                    this.emitter.emitDataAddress(this.getTempScalarAddr(0));
                    this.emitSyscallArg(argIndex);
                    this.generateMember(argExpr);
                    continue;
                }
                this.generateExpression(argExpr);
                this.emitSyscallArg(argIndex);
            } else {
                if (argExpr.kind === 'MemberExpr') {
                    this.generateMember(argExpr);
                    this.emitSyscallArg(argIndex);
                } else {
                    this.generateExpression(argExpr);
                    this.emitSyscallArg(argIndex);
                }
            }
        }
        this.emitSyscallByName(syscallName);
    }

    private emitStringCallResultToAddr(expr: AST.CallExpr, addr: number, isByRef = false): boolean {
        if (expr.callee.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.callee.name);
            if (sym && sym.kind === SymbolKind.Function) {
                const fn = sym as FunctionSymbol;
                const retVar = this.getFunctionReturnVar(fn);
                if (fn.returnType && isString(fn.returnType) && retVar?.address !== undefined) {
                    this.emitFunctionCall(fn, expr.args);
                    this.emitLeaToArg(addr, 0, isByRef);
                    this.emitLeaToArg(retVar.address, 1);
                    this.emitSyscallByName('strcpy');
                    return true;
                }
            }
            if (sym && sym.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                if (sc.returnType && isString(sc.returnType)) {
                    this.emitLeaToArg(addr, 0, isByRef);
                    this.emitSyscallWithArgs(sc.name, sc, expr.args, 1);
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
                    this.emitLeaToArg(addr, 0, isByRef);
                    this.emitSyscallWithArgs(fn.name, fn, expr.args, 1);
                    return true;
                }
            }
        }

        return false;
    }

    private emitStringExprToArg(expr: AST.Expression, argIndex: number): void {
        const tempAddr = this.getTempStringAddr(0);
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.emitStringExprToTemp(expr.left, tempAddr, true);
            this.emitStringCatToTemp(expr.right, tempAddr);
        } else if (expr.kind === 'StringLiteral') {
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(argIndex);
            return;
        } else if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaArgAt(varSym, argIndex);
                return;
            }
        } else if (expr.kind === 'MemberExpr' && this.tryEmitPropertyGetterDirect(expr, tempAddr)) {
            this.emitLeaToArg(tempAddr, argIndex);
            return;
        } else if (expr.kind === 'CallExpr' && this.emitStringCallResultToAddr(expr, tempAddr)) {
            this.emitLeaToArg(tempAddr, argIndex);
            return;
        }
        this.emitLeaToArg(tempAddr, argIndex);
    }

    private emitStringExprToTemp(expr: AST.Expression, tempAddr: number, isFirst: boolean): void {
        if (expr.kind === 'BinaryExpr' && expr.op === AST.BinaryOp.Add) {
            this.emitStringExprToTemp(expr.left, tempAddr, isFirst);
            this.emitStringCatToTemp(expr.right, tempAddr);
            return;
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
        } else if (expr.kind === 'CallExpr') {
            if (this.emitStringCallResultToAddr(expr, tempAddr)) {
                if (!isFirst) {
                    this.emitLeaToArg(tempAddr, 1);
                    this.emitSyscallByName('strcat');
                }
                return;
            }
        } else if (expr.kind === 'MemberExpr') {
            const sourceAddr = isFirst ? tempAddr : tempAddr + 260;
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

        this.emitter.emitByte(OP.OPCODE_LEA);
        this.emitter.emitDataAddress(tempAddr);
        this.emitSyscallArg(0);

        if (expr.kind === 'StringLiteral') {
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strcat');
        } else if (expr.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitVarLeaArgAt(varSym, 1);
                this.emitSyscallByName('strcat');
            }
        } else if (expr.kind === 'CallExpr') {
            if (this.emitStringCallResultToAddr(expr, tempAddr)) {
                this.emitLeaToArg(tempAddr, 1);
                this.emitSyscallByName('strcat');
                return;
            }
        } else if (expr.kind === 'MemberExpr') {
            const sourceAddr = tempAddr + 260;
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
        for (const decl of program.declarations) {
            if (decl.kind !== 'DimStmt' || decl.isDeclare) continue;
            if (!this.isFromCurrentFile(decl)) continue;
            for (const v of decl.variables) {
                const sym = this.symbols.lookupGlobal(v.name) as VariableSymbol | undefined;
                if (!sym) continue;
                const size = sym.dataType?.size ?? 2;
                sym.address = offset;
                this.emitter.defineDataLabel(`?V:${v.name}`, offset);
                offset += size;
            }
        }
        this.tempScratchBase = offset;
        this.globalDataOffset = offset;
    }

    private allocateFunctionFrames(program: AST.Program): void {
        const STACK_SIZE = 15;
        let localBase = STACK_SIZE;

        for (const decl of program.declarations) {
            if (decl.kind !== 'SubDecl' && decl.kind !== 'FunctionDecl') continue;
            if (!this.isFromCurrentFile(decl)) continue;
            const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
            if (!sym) continue;

            let offset = 0;
            for (const p of sym.parameters) {
                p.address = localBase + offset;
                offset += p.dataType?.size ?? 2;
            }
            for (const v of sym.localVariables) {
                v.address = localBase + offset;
                offset += v.dataType?.size ?? 2;
            }
            sym.localAllocSize = offset;
            if (offset > this.localAllocSize) {
                this.localAllocSize = offset;
            }
            localBase += offset;
        }
    }

    private allocateLocals(_fn: FunctionSymbol): void {
        // Addresses already assigned in allocateFunctionFrames
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
        if (!sym || decl.body.length === 0) return;

        const endLabel = this.makeLabel('sub_end');
        this.ctx.currentFunction = sym;
        this.ctx.functionEndLabel = endLabel;

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
        if (!sym || decl.body.length === 0) return;

        const endLabel = this.makeLabel('func_end');
        this.ctx.currentFunction = sym;
        this.ctx.functionEndLabel = endLabel;

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
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                const dt = varSym.dataType;
                if (dt && isString(dt)) {
                    this.generateStringAssignment(varSym, value);
                    return;
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
                this.emitLoad(counterSym as VariableSymbol);
                this.emitSecondOperand(stmt.to);
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
                this.emitInitObjAtAddr(addr, varSym.isByRef);
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
        } else if (value >= -32768 && value <= 65535) {
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
            this.diagnostics.warning(expr.loc, `Undefined identifier: ${expr.name}`);
            return;
        }

        switch (sym.kind) {
            case SymbolKind.Variable:
            case SymbolKind.Parameter: {
                const varSym = sym as VariableSymbol;
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
            const tempAddr = this.getTempStringAddr(argIndex);
            const rdataOff = this.emitter.addStringRData(expr.value);
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddress(tempAddr);
            this.emitSyscallArg(0);
            this.emitRDataLoad(rdataOff);
            this.emitSyscallArg(1);
            this.emitSyscallByName('strload');
            this.emitter.emitByte(OP.OPCODE_LEA);
            this.emitter.emitDataAddress(tempAddr);
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

            if (sym && sym.kind === SymbolKind.Syscall) {
                const sc = sym as SyscallSymbol;
                this.emitSyscallWithArgs(sc.name, sc, expr.args);
                return;
            }

            if (sym && (sym.kind === SymbolKind.Function || sym.kind === SymbolKind.Sub)) {
                const fn = sym as FunctionSymbol;
                this.emitFunctionCall(fn, expr.args);
                const retVar = this.getFunctionReturnVar(fn);
                if (fn.returnType && retVar?.address !== undefined && !isString(fn.returnType)) {
                    const loadOp = getLoadOpcode(fn.returnType, 'A');
                    this.emitter.emitByte(loadOp | OP.OPCODE_DIRECT);
                    this.emitter.emitDataAddress(retVar.address);
                }
                return;
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
                if (argExpr.kind === 'IdentifierExpr') {
                    const argSym = this.symbols.current.lookup(argExpr.name);
                    if (argSym && (argSym.kind === SymbolKind.Variable || argSym.kind === SymbolKind.Parameter)) {
                        const aVarSym = argSym as VariableSymbol;
                        this.emitter.emitByte(OP.OPCODE_LEA);
                        this.emitVarDataAddress(aVarSym);
                        this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                        this.emitter.emitDataAddress(param.address ?? 0);
                        continue;
                    }
                }
                this.generateExpression(argExpr);
                this.emitter.emitByte(OP.OPCODE_STO32 | OP.OPCODE_DIRECT);
                this.emitter.emitDataAddress(param.address ?? 0);
                continue;
            }

            const paramDt = param.dataType;
            if (paramDt && isString(paramDt)) {
                const strType = paramDt as StringDataType;
                const paramAddr = param.address ?? 0;
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
                    if (srcSym && (srcSym.kind === SymbolKind.Variable || srcSym.kind === SymbolKind.Parameter)) {
                        const src = srcSym as VariableSymbol;
                        this.emitLeaArg(paramAddr);
                        this.emitVarLeaArgAt(src, 1);
                        this.emitSyscallByName('strcpy');
                    }
                } else {
                    this.generateStringAssignment({ address: paramAddr, dataType: paramDt, kind: SymbolKind.Variable, isByRef: false, isGlobal: false, name: '', scope: '' } as unknown as VariableSymbol, argExpr);
                }
                continue;
            }

            this.generateExpression(argExpr);
            const storeOp = getStoreOpcode(paramDt ?? BUILTIN_TYPES.word);
            this.emitter.emitByte(storeOp | OP.OPCODE_DIRECT);
            this.emitter.emitDataAddress(param.address ?? 0);
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

    // ─── Index expression ───────────────────────────────────────────────────

    private generateIndex(expr: AST.IndexExpr): void {
        if (expr.object.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.object.name);
            if (sym && (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Parameter)) {
                const varSym = sym as VariableSymbol;
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitVarDataAddress(varSym);
                this.emitSyscallArg(0);

                if (expr.indices.length > 0) {
                    this.generateExpression(expr.indices[0]);
                    this.emitSyscallArg(1);
                }

                this.emitSyscallByName('gotoidx');
                return;
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
                this.emitter.emitByte(OP.OPCODE_LEA);
                this.emitVarDataAddress(varSym);
                this.emitSyscallArg(0);

                if (target.indices.length > 0) {
                    this.generateExpression(target.indices[0]);
                    this.emitSyscallArg(1);
                }

                this.emitSyscallByName('gotoidx');

                this.generateExpression(value);
                this.emitSyscallByName('setidx');
                return;
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
