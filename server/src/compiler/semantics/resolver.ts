import * as AST from '../ast/nodes';
import { DiagnosticCollection, SourceLocation } from '../errors';
import {
    DataType, BUILTIN_TYPES, makeStringType, makeArrayType, makeStructType, makeEnumType,
    StructMember, EnumMember, PrimitiveType, PrimitiveDataType,
} from './types';
import {
    SymbolTable, Scope, ScopeType, SymbolKind,
    VariableSymbol, ConstantSymbol, FunctionSymbol, TypeSymbol, EnumSymbol,
    ObjectSymbol, PropertySymbol, SyscallSymbol, EventSymbol, LabelSymbol,
} from './symbols';

export class SemanticResolver {
    readonly symbols: SymbolTable;
    readonly diagnostics: DiagnosticCollection;
    private typeRegistry = new Map<string, DataType>();
    private eventMap = new Map<string, number>();

    constructor(diagnostics: DiagnosticCollection) {
        this.symbols = new SymbolTable();
        this.diagnostics = diagnostics;

        for (const [name, type] of Object.entries(BUILTIN_TYPES)) {
            this.typeRegistry.set(name, type);
        }
    }

    resolve(program: AST.Program): void {
        // Pass 1a: collect enums, types, objects first (they define types used elsewhere)
        for (const decl of program.declarations) {
            if (decl.kind === 'EnumDecl' || decl.kind === 'TypeDecl' || decl.kind === 'ObjectDecl') {
                this.collectDeclaration(decl);
            }
        }
        // Pass 1b: collect everything else (variables, functions, syscalls, etc.)
        for (const decl of program.declarations) {
            if (decl.kind !== 'EnumDecl' && decl.kind !== 'TypeDecl' && decl.kind !== 'ObjectDecl') {
                this.collectDeclaration(decl);
            }
        }
        // Pass 2: resolve function/sub bodies
        for (const decl of program.declarations) {
            this.resolveDeclaration(decl);
        }
    }

    // ─── First pass: declarations ────────────────────────────────────────────

    private collectDeclaration(decl: AST.TopLevelDeclaration): void {
        switch (decl.kind) {
            case 'EnumDecl': this.collectEnum(decl); break;
            case 'TypeDecl': this.collectType(decl); break;
            case 'ObjectDecl': this.collectObject(decl); break;
            case 'EventDecl': this.collectEvent(decl); break;
            case 'SyscallDecl': this.collectSyscall(decl); break;
            case 'DeclareSubStmt': this.collectDeclareSubOrFunc(decl); break;
            case 'DeclareFuncStmt': this.collectDeclareSubOrFunc(decl); break;
            case 'PropertyDecl': this.collectProperty(decl); break;
            case 'ConstDecl': this.collectConst(decl); break;
            case 'DimStmt': this.collectDim(decl); break;
        }
    }

    private collectEnum(decl: AST.EnumDecl): void {
        const members: EnumMember[] = [];
        let autoVal = BigInt(0);
        for (const m of decl.members) {
            if (m.value) {
                autoVal = BigInt(this.evaluateConstExpr(m.value));
            }
            members.push({ name: m.name, value: autoVal });
            autoVal++;
        }
        const enumType = makeEnumType(decl.name, members);
        this.typeRegistry.set(decl.name.toLowerCase(), enumType);

        const enumSym: EnumSymbol = {
            name: decl.name, kind: SymbolKind.Enum, dataType: enumType,
            location: decl.loc, isPublic: false, isDeclare: false,
        };
        this.symbols.defineGlobal(enumSym);

        for (const m of members) {
            const constSym: ConstantSymbol = {
                name: m.name, kind: SymbolKind.Constant, dataType: enumType.actualType,
                location: decl.loc, isPublic: false, isDeclare: false, value: Number(m.value),
            };
            this.symbols.defineGlobal(constSym);
        }
    }

    private collectType(decl: AST.TypeDecl): void {
        const structMembers: StructMember[] = [];
        let offset = 0;
        for (let i = 0; i < decl.members.length; i++) {
            const m = decl.members[i];
            const dt = this.resolveTypeRef(m.typeRef);
            let memberType = dt;
            if (m.arraySize) {
                const size = this.evaluateConstExpr(m.arraySize);
                memberType = makeArrayType(dt, [size]);
            }
            structMembers.push({ name: m.name, index: i, offset, dataType: memberType });
            offset += memberType.size;
        }
        const structType = makeStructType(decl.name, structMembers);
        this.typeRegistry.set(decl.name.toLowerCase(), structType);

        const typeSym: TypeSymbol = {
            name: decl.name, kind: SymbolKind.Type, dataType: structType,
            location: decl.loc, isPublic: decl.isPublic, isDeclare: false,
        };
        this.symbols.defineGlobal(typeSym);
    }

    private collectObject(decl: AST.ObjectDecl): void {
        const objSym: ObjectSymbol = {
            name: decl.name, kind: SymbolKind.Object,
            location: decl.loc, isPublic: false, isDeclare: false,
            properties: new Map(), functions: new Map(), events: new Map(),
        };
        this.symbols.defineGlobal(objSym);
    }

    private collectEvent(decl: AST.EventDecl): void {
        const params = this.resolveParams(decl.params);
        const evSym: EventSymbol = {
            name: decl.name, kind: SymbolKind.Event, eventNumber: decl.eventNumber,
            parameters: params, location: decl.loc, isPublic: false, isDeclare: false,
        };
        this.symbols.defineGlobal(evSym);
        this.eventMap.set(decl.name.toLowerCase(), decl.eventNumber);
    }

    private collectSyscall(decl: AST.SyscallDecl): void {
        const params = this.resolveParams(decl.params);
        const returnType = decl.returnType ? this.resolveTypeRef(decl.returnType) : undefined;
        const sysSym: SyscallSymbol = {
            name: decl.name, kind: SymbolKind.Syscall, syscallNumber: decl.syscallNumber,
            syscallLib: decl.syscallLib, objectName: decl.objectName,
            parameters: params, returnType,
            location: decl.loc, isPublic: false, isDeclare: false,
        };
        this.symbols.defineGlobal(sysSym);

        if (decl.objectName) {
            const objSym = this.symbols.lookupGlobal(decl.objectName) as ObjectSymbol | undefined;
            if (objSym && objSym.kind === SymbolKind.Object) {
                objSym.functions.set(decl.name.toLowerCase(), sysSym);
            }
        }
    }

    private collectProperty(decl: AST.PropertyDecl): void {
        const propSym: PropertySymbol = {
            name: decl.propertyName, kind: SymbolKind.Property, objectName: decl.objectName,
            getterSyscall: decl.getter?.syscallNumber,
            setterSyscall: decl.setter?.syscallNumber,
            dataType: decl.getter?.returnType ? this.resolveTypeRef(decl.getter.returnType) : undefined,
            location: decl.loc, isPublic: false, isDeclare: false,
        };
        this.symbols.defineGlobal(propSym);

        const objSym = this.symbols.lookupGlobal(decl.objectName) as ObjectSymbol | undefined;
        if (objSym && objSym.kind === SymbolKind.Object) {
            objSym.properties.set(decl.propertyName.toLowerCase(), propSym);
        }
    }

    private collectDeclareSubOrFunc(decl: AST.DeclareSubStmt | AST.DeclareFuncStmt): void {
        const params = this.resolveParams(decl.params);
        const returnType = decl.kind === 'DeclareFuncStmt' ? this.resolveTypeRef(decl.returnType) : undefined;
        const kind = decl.kind === 'DeclareFuncStmt' ? SymbolKind.Function : SymbolKind.Sub;

        const funSym: FunctionSymbol = {
            name: decl.name, kind, parameters: params, returnType,
            localVariables: [], callees: new Set(), isEvent: false,
            location: decl.loc, isPublic: false, isDeclare: true,
        };
        this.symbols.defineGlobal(funSym);
    }

    private collectConst(decl: AST.ConstDecl): void {
        for (const c of decl.constants) {
            const value = this.evaluateConstExpr(c.value);
            const constSym: ConstantSymbol = {
                name: c.name, kind: SymbolKind.Constant, value,
                location: c.loc, isPublic: false, isDeclare: false,
            };
            this.symbols.defineGlobal(constSym);
        }
    }

    private collectDim(decl: AST.DimStmt): void {
        const dt = decl.typeRef ? this.resolveTypeRef(decl.typeRef) : BUILTIN_TYPES.byte;
        for (const v of decl.variables) {
            let varType: DataType = dt;
            if (v.dimensions && v.dimensions.length > 0) {
                const dims = v.dimensions.map(d => this.evaluateConstExpr(d));
                varType = makeArrayType(dt, dims);
            }
            const varSym: VariableSymbol = {
                name: v.name, kind: SymbolKind.Variable, dataType: varType,
                location: decl.loc, isPublic: decl.isPublic, isDeclare: decl.isDeclare,
                isByRef: false, isGlobal: true,
            };
            this.symbols.defineGlobal(varSym);
        }
    }

    // ─── Second pass: bodies ─────────────────────────────────────────────────

    private resolveDeclaration(decl: AST.TopLevelDeclaration): void {
        switch (decl.kind) {
            case 'SubDecl': this.resolveSubOrFunction(decl); break;
            case 'FunctionDecl': this.resolveSubOrFunction(decl); break;
        }
    }

    private resolveSubOrFunction(decl: AST.SubDecl | AST.FunctionDecl): void {
        const kind = decl.kind === 'FunctionDecl' ? SymbolKind.Function : SymbolKind.Sub;
        const scopeType = decl.kind === 'FunctionDecl' ? ScopeType.Function : ScopeType.Sub;
        const params = this.resolveParams('params' in decl ? decl.params : []);
        const returnType = decl.kind === 'FunctionDecl' ? this.resolveTypeRef(decl.returnType) : undefined;

        const eventNumber = this.eventMap.get(decl.name.toLowerCase());
        let existing = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
        if (!existing || (existing.kind !== kind && existing.kind !== SymbolKind.Event as any)) {
            existing = {
                name: decl.name, kind, parameters: params, returnType,
                localVariables: [], callees: new Set(),
                isEvent: eventNumber !== undefined, eventNumber,
                location: decl.loc, isPublic: decl.isPublic, isDeclare: false,
            };
            this.symbols.defineGlobal(existing);
        } else if (existing.kind === SymbolKind.Event as any) {
            existing = {
                name: decl.name, kind, parameters: params, returnType,
                localVariables: [], callees: new Set(),
                isEvent: true, eventNumber: eventNumber ?? (existing as any).eventNumber,
                location: decl.loc, isPublic: decl.isPublic, isDeclare: false,
            };
            this.symbols.defineGlobal(existing);
        } else {
            existing.isDeclare = false;
            existing.parameters = params;
            if (returnType) existing.returnType = returnType;
            existing.location = decl.loc;
            existing.isPublic = decl.isPublic;
            if (eventNumber !== undefined) {
                existing.isEvent = true;
                existing.eventNumber = eventNumber;
            }
        }

        const scope = this.symbols.pushScope(scopeType);
        scope.ownerFunction = existing;

        for (const p of params) {
            this.symbols.define(p);
        }

        if (decl.kind === 'FunctionDecl') {
            const retVar: VariableSymbol = {
                name: decl.name, kind: SymbolKind.Variable, dataType: returnType,
                location: decl.loc, isPublic: false, isDeclare: false,
                isByRef: false, isGlobal: false,
            };
            this.symbols.define(retVar);
        }

        this.resolveBlock(decl.body);
        this.symbols.popScope();
    }

    private resolveBlock(stmts: AST.Statement[]): void {
        for (const stmt of stmts) {
            this.resolveStatement(stmt);
        }
    }

    private resolveStatement(stmt: AST.Statement): void {
        switch (stmt.kind) {
            case 'DimStmt':
                this.resolveDimLocal(stmt);
                break;
            case 'ConstDecl':
                this.collectConst(stmt);
                break;
            case 'LabelStmt':
                this.resolveLabel(stmt);
                break;
            case 'ForStmt':
                this.resolveFor(stmt);
                break;
            case 'WhileStmt':
                this.resolveWhile(stmt);
                break;
            case 'DoLoopStmt':
                this.resolveDoLoop(stmt);
                break;
            case 'IfStmt':
                this.resolveIf(stmt);
                break;
            case 'SelectCaseStmt':
                this.resolveSelectCase(stmt);
                break;
            case 'ExpressionStmt':
            case 'GotoStmt':
            case 'ExitStmt':
                break;
        }
    }

    private resolveDimLocal(decl: AST.DimStmt): void {
        const dt = decl.typeRef ? this.resolveTypeRef(decl.typeRef) : BUILTIN_TYPES.byte;
        for (const v of decl.variables) {
            let varType: DataType = dt;
            if (v.dimensions && v.dimensions.length > 0) {
                const dims = v.dimensions.map(d => this.evaluateConstExpr(d));
                varType = makeArrayType(dt, dims);
            }
            const varSym: VariableSymbol = {
                name: v.name, kind: SymbolKind.Variable, dataType: varType,
                location: decl.loc, isPublic: false, isDeclare: false,
                isByRef: false, isGlobal: false,
            };
            this.symbols.define(varSym);

            const fn = this.symbols.current.ownerFunction;
            if (fn) fn.localVariables.push(varSym);
        }
    }

    private resolveLabel(stmt: AST.LabelStmt): void {
        const labelSym: LabelSymbol = {
            name: stmt.name, kind: SymbolKind.Label,
            location: stmt.loc, isPublic: false, isDeclare: false, defined: true,
        };
        this.symbols.define(labelSym);
    }

    private resolveFor(stmt: AST.ForStmt): void {
        const scope = this.symbols.pushScope(ScopeType.For);
        this.resolveBlock(stmt.body);
        this.symbols.popScope();
    }

    private resolveWhile(stmt: AST.WhileStmt): void {
        const scope = this.symbols.pushScope(ScopeType.While);
        this.resolveBlock(stmt.body);
        this.symbols.popScope();
    }

    private resolveDoLoop(stmt: AST.DoLoopStmt): void {
        const scope = this.symbols.pushScope(ScopeType.Do);
        this.resolveBlock(stmt.body);
        this.symbols.popScope();
    }

    private resolveIf(stmt: AST.IfStmt): void {
        const ifScope = this.symbols.pushScope(ScopeType.If);
        this.resolveBlock(stmt.thenBody);
        this.symbols.popScope();

        for (const branch of stmt.elseIfBranches) {
            const elseIfScope = this.symbols.pushScope(ScopeType.If);
            this.resolveBlock(branch.body);
            this.symbols.popScope();
        }

        if (stmt.elseBody) {
            const elseScope = this.symbols.pushScope(ScopeType.Else);
            this.resolveBlock(stmt.elseBody);
            this.symbols.popScope();
        }
    }

    private resolveSelectCase(stmt: AST.SelectCaseStmt): void {
        for (const c of stmt.cases) {
            const scope = this.symbols.pushScope(ScopeType.Case);
            this.resolveBlock(c.body);
            this.symbols.popScope();
        }
        if (stmt.defaultCase) {
            const scope = this.symbols.pushScope(ScopeType.Case);
            this.resolveBlock(stmt.defaultCase);
            this.symbols.popScope();
        }
    }

    // ─── Type resolution ─────────────────────────────────────────────────────

    resolveTypeRef(typeRef: AST.TypeRefNode): DataType {
        const tn = typeRef.typeName;

        if (tn.kind === 'BaseType') {
            if (tn.baseType === AST.BaseTypeKind.String) {
                let maxLen = 255;
                if (tn.stringSize) maxLen = this.evaluateConstExpr(tn.stringSize);
                return makeStringType(maxLen);
            }
            return BUILTIN_TYPES[tn.baseType] ?? BUILTIN_TYPES.byte;
        }

        if (tn.kind === 'ComplexType') {
            const fullName = tn.parts.join('.').toLowerCase();
            const registered = this.typeRegistry.get(fullName);
            if (registered) return registered;
            const singleName = tn.parts[0].toLowerCase();
            const reg2 = this.typeRegistry.get(singleName);
            if (reg2) return reg2;
            this.diagnostics.error(typeRef.loc, `Unknown type: ${tn.parts.join('.')}`);
            return BUILTIN_TYPES.byte;
        }

        return BUILTIN_TYPES.byte;
    }

    private resolveParams(params: AST.ParamDecl[]): VariableSymbol[] {
        return params.map(p => {
            let dt: DataType | undefined;
            if (p.typeRef) dt = this.resolveTypeRef(p.typeRef);
            if (p.arraySize != null && dt) {
                dt = makeArrayType(dt, [p.arraySize]);
            }
            return {
                name: p.name,
                kind: SymbolKind.Parameter as const,
                dataType: dt,
                location: p.loc,
                isPublic: false,
                isDeclare: false,
                isByRef: p.passMode === AST.PassMode.ByRef,
                isGlobal: false,
            };
        });
    }

    // ─── Constant evaluation ─────────────────────────────────────────────────

    evaluateConstExpr(expr: AST.Expression): number {
        switch (expr.kind) {
            case 'IntegerLiteral': return expr.value;
            case 'FloatLiteral': return expr.value;
            case 'HexLiteral': return expr.value;
            case 'BinLiteral': return expr.value;
            case 'BooleanLiteral': return expr.value ? 1 : 0;
            case 'IdentifierExpr': {
                const sym = this.symbols.lookup(expr.name);
                if (sym && sym.kind === SymbolKind.Constant) {
                    return typeof (sym as ConstantSymbol).value === 'number' ? (sym as ConstantSymbol).value as number : 0;
                }
                return 0;
            }
            case 'UnaryExpr': {
                const v = this.evaluateConstExpr(expr.operand);
                return expr.op === AST.UnaryOp.Neg ? -v : ~v;
            }
            case 'BinaryExpr': {
                const l = this.evaluateConstExpr(expr.left);
                const r = this.evaluateConstExpr(expr.right);
                switch (expr.op) {
                    case AST.BinaryOp.Add: return l + r;
                    case AST.BinaryOp.Sub: return l - r;
                    case AST.BinaryOp.Mul: return l * r;
                    case AST.BinaryOp.Div: return r !== 0 ? Math.trunc(l / r) : 0;
                    case AST.BinaryOp.Mod: return r !== 0 ? l % r : 0;
                    case AST.BinaryOp.And: return l & r;
                    case AST.BinaryOp.Or: return l | r;
                    case AST.BinaryOp.Xor: return l ^ r;
                    case AST.BinaryOp.Shl: return l << r;
                    case AST.BinaryOp.Shr: return l >> r;
                    default: return 0;
                }
            }
            case 'ParenExpr': return this.evaluateConstExpr(expr.expression);
            default: return 0;
        }
    }

    getType(name: string): DataType | undefined {
        return this.typeRegistry.get(name.toLowerCase());
    }

    registerType(name: string, type: DataType): void {
        this.typeRegistry.set(name.toLowerCase(), type);
    }

    getMaxEventNumber(): number {
        let max = -1;
        for (const num of this.eventMap.values()) {
            if (num > max) max = num;
        }
        return max;
    }
}
