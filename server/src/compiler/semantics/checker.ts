import * as AST from '../ast/nodes';
import { DiagnosticCollection } from '../errors';
import {
    DataType, BUILTIN_TYPES, isNumeric, isIntegral, isFloat, isString,
    isArray, isStruct, isEnum, typesCompatible, getPromotedType, makeStringType,
} from './types';
import { SymbolTable, ScopeType, SymbolKind, ConstantSymbol, FunctionSymbol, VariableSymbol, ObjectSymbol, SyscallSymbol, PropertySymbol } from './symbols';
import { SemanticResolver } from './resolver';

export class TypeChecker {
    private symbols: SymbolTable;
    private diagnostics: DiagnosticCollection;
    private resolver: SemanticResolver;

    constructor(symbols: SymbolTable, diagnostics: DiagnosticCollection, resolver: SemanticResolver) {
        this.symbols = symbols;
        this.diagnostics = diagnostics;
        this.resolver = resolver;
    }

    check(program: AST.Program): void {
        for (const decl of program.declarations) {
            this.checkDeclaration(decl);
        }
    }

    private checkDeclaration(decl: AST.TopLevelDeclaration): void {
        switch (decl.kind) {
            case 'SubDecl':
            case 'FunctionDecl': {
                const sym = this.symbols.lookupGlobal(decl.name) as FunctionSymbol | undefined;
                if (sym) {
                    const scopeType = decl.kind === 'FunctionDecl' ? ScopeType.Function : ScopeType.Sub;
                    const scope = this.symbols.pushScope(scopeType);
                    scope.ownerFunction = sym;
                    for (const p of sym.parameters) this.symbols.define(p);
                    for (const v of sym.localVariables) this.symbols.define(v);
                    this.checkBlock(decl.body);
                    this.symbols.popScope();
                } else {
                    this.checkBlock(decl.body);
                }
                break;
            }
        }
    }

    private checkBlock(stmts: AST.Statement[]): void {
        for (const stmt of stmts) {
            this.checkStatement(stmt);
        }
    }

    private checkStatement(stmt: AST.Statement): void {
        switch (stmt.kind) {
            case 'ExpressionStmt':
                this.inferType(stmt.expression);
                break;
            case 'IfStmt':
                this.inferType(stmt.condition);
                this.checkBlock(stmt.thenBody);
                for (const branch of stmt.elseIfBranches) {
                    this.inferType(branch.condition);
                    this.checkBlock(branch.body);
                }
                if (stmt.elseBody) this.checkBlock(stmt.elseBody);
                break;
            case 'ForStmt':
                this.inferType(stmt.init);
                this.inferType(stmt.to);
                if (stmt.step) this.inferType(stmt.step);
                this.checkBlock(stmt.body);
                break;
            case 'WhileStmt':
                this.inferType(stmt.condition);
                this.checkBlock(stmt.body);
                break;
            case 'DoLoopStmt':
                if (stmt.condition) this.inferType(stmt.condition);
                this.checkBlock(stmt.body);
                break;
            case 'SelectCaseStmt':
                this.inferType(stmt.testExpr);
                for (const c of stmt.cases) {
                    for (const cond of c.conditions) this.inferType(cond);
                    this.checkBlock(c.body);
                }
                if (stmt.defaultCase) this.checkBlock(stmt.defaultCase);
                break;
            case 'GotoStmt': {
                const label = this.symbols.current.lookup(stmt.target);
                if (!label) {
                    // Label may be forward-declared; we allow it for now
                }
                break;
            }
        }
    }

    inferType(expr: AST.Expression): DataType {
        switch (expr.kind) {
            case 'IntegerLiteral':
            case 'HexLiteral':
            case 'BinLiteral': {
                const v = expr.value;
                if (v >= 0 && v <= 0xFF) return BUILTIN_TYPES.byte;
                if (v >= -128 && v <= 127) return BUILTIN_TYPES.char;
                if (v >= 0 && v <= 0xFFFF) return BUILTIN_TYPES.word;
                if (v >= -32768 && v <= 32767) return BUILTIN_TYPES.short;
                if (v >= 0 && v <= 0xFFFFFFFF) return BUILTIN_TYPES.dword;
                return BUILTIN_TYPES.long;
            }
            case 'FloatLiteral': return BUILTIN_TYPES.real;
            case 'StringLiteral': return makeStringType(expr.value.length);
            case 'BooleanLiteral': return BUILTIN_TYPES.boolean;
            case 'IdentifierExpr': return this.inferIdentifier(expr);
            case 'BinaryExpr': return this.inferBinary(expr);
            case 'UnaryExpr': return this.inferUnary(expr);
            case 'CallExpr': return this.inferCall(expr);
            case 'MemberExpr': return this.inferMember(expr);
            case 'IndexExpr': return this.inferIndex(expr);
            case 'ParenExpr': return this.inferType(expr.expression);
        }
    }

    private inferIdentifier(expr: AST.IdentifierExpr): DataType {
        const sym = this.symbols.current.lookup(expr.name);
        if (!sym) {
            return BUILTIN_TYPES.byte;
        }
        if (sym.dataType) return sym.dataType;
        if (sym.kind === SymbolKind.Constant) {
            const c = sym as ConstantSymbol;
            if (typeof c.value === 'string') return makeStringType(c.value.length);
            if (typeof c.value === 'boolean') return BUILTIN_TYPES.boolean;
            return BUILTIN_TYPES.long;
        }
        return BUILTIN_TYPES.byte;
    }

    private inferBinary(expr: AST.BinaryExpr): DataType {
        const lt = this.inferType(expr.left);
        const rt = this.inferType(expr.right);

        switch (expr.op) {
            case AST.BinaryOp.Eq:
            case AST.BinaryOp.Neq:
            case AST.BinaryOp.Lt:
            case AST.BinaryOp.Gt:
            case AST.BinaryOp.Leq:
            case AST.BinaryOp.Geq:
                return BUILTIN_TYPES.boolean;
            case AST.BinaryOp.Add:
                if (isString(lt) || isString(rt)) return makeStringType(255);
                return getPromotedType(lt, rt);
            default:
                return getPromotedType(lt, rt);
        }
    }

    private inferUnary(expr: AST.UnaryExpr): DataType {
        return this.inferType(expr.operand);
    }

    private inferCall(expr: AST.CallExpr): DataType {
        if (expr.callee.kind === 'IdentifierExpr') {
            const sym = this.symbols.current.lookup(expr.callee.name);
            if (sym) {
                if (sym.kind === SymbolKind.Function && (sym as FunctionSymbol).returnType) {
                    return (sym as FunctionSymbol).returnType!;
                }
                if (sym.kind === SymbolKind.Syscall && (sym as SyscallSymbol).returnType) {
                    return (sym as SyscallSymbol).returnType!;
                }
            }
        }
        if (expr.callee.kind === 'MemberExpr') {
            return this.inferMemberCall(expr.callee, expr.args);
        }
        return BUILTIN_TYPES.byte;
    }

    private inferMember(expr: AST.MemberExpr): DataType {
        if (expr.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(expr.object.name);
            if (objSym?.kind === SymbolKind.Object) {
                const obj = objSym as ObjectSymbol;
                const prop = obj.properties.get(expr.property.toLowerCase());
                if (prop?.dataType) return prop.dataType;
                const fn = obj.functions.get(expr.property.toLowerCase());
                if (fn?.returnType) return fn.returnType;
            }
        }
        const objType = this.inferType(expr.object);
        if (isStruct(objType)) {
            const member = objType.memberMap.get(expr.property.toLowerCase());
            if (member) return member.dataType;
        }
        return BUILTIN_TYPES.byte;
    }

    private inferMemberCall(member: AST.MemberExpr, _args: AST.Expression[]): DataType {
        if (member.object.kind === 'IdentifierExpr') {
            const objSym = this.symbols.current.lookup(member.object.name);
            if (objSym?.kind === SymbolKind.Object) {
                const fn = (objSym as ObjectSymbol).functions.get(member.property.toLowerCase());
                if (fn?.returnType) return fn.returnType;
            }
        }
        return BUILTIN_TYPES.byte;
    }

    private inferIndex(expr: AST.IndexExpr): DataType {
        const objType = this.inferType(expr.object);
        if (isArray(objType)) return objType.elementType;
        if (isString(objType)) return BUILTIN_TYPES.byte;
        return BUILTIN_TYPES.byte;
    }
}
