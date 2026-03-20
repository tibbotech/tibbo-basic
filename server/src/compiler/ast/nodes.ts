import { SourceLocation } from '../errors';

// ─── Base ────────────────────────────────────────────────────────────────────

export interface ASTNode {
    kind: string;
    loc: SourceLocation;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export enum BaseTypeKind {
    Boolean = 'boolean',
    Char = 'char',
    Byte = 'byte',
    Short = 'short',
    Word = 'word',
    Integer = 'integer',
    Long = 'long',
    Dword = 'dword',
    Float = 'float',
    Real = 'real',
    String = 'string',
}

export interface BaseTypeNode extends ASTNode {
    kind: 'BaseType';
    baseType: BaseTypeKind;
    stringSize?: Expression; // for STRING * n
}

export interface ComplexTypeNode extends ASTNode {
    kind: 'ComplexType';
    parts: string[]; // e.g. ["pl_io_num"] or ["sock", "state"]
}

export interface ArrayTypeNode extends ASTNode {
    kind: 'ArrayType';
    elementType: TypeNode;
    dimensions: Expression[];
}

export interface TypeRefNode extends ASTNode {
    kind: 'TypeRef';
    typeName: TypeNode;
    isEnum: boolean;
    sizeExpr?: Expression; // for type(N)
}

export type TypeNode = BaseTypeNode | ComplexTypeNode | ArrayTypeNode | TypeRefNode;

// ─── Expressions ─────────────────────────────────────────────────────────────

export enum BinaryOp {
    Add = '+',
    Sub = '-',
    Mul = '*',
    Div = '/',
    Mod = 'mod',
    And = 'and',
    Or = 'or',
    Xor = 'xor',
    Shl = 'shl',
    Shr = 'shr',
    Eq = '=',
    Neq = '<>',
    Lt = '<',
    Gt = '>',
    Leq = '<=',
    Geq = '>=',
    Not = 'not',
}

export enum UnaryOp {
    Neg = '-',
    Not = 'not',
}

export interface BinaryExpr extends ASTNode {
    kind: 'BinaryExpr';
    op: BinaryOp;
    left: Expression;
    right: Expression;
}

export interface UnaryExpr extends ASTNode {
    kind: 'UnaryExpr';
    op: UnaryOp;
    operand: Expression;
}

export interface IntegerLiteral extends ASTNode {
    kind: 'IntegerLiteral';
    value: number;
}

export interface FloatLiteral extends ASTNode {
    kind: 'FloatLiteral';
    value: number;
}

export interface StringLiteral extends ASTNode {
    kind: 'StringLiteral';
    value: string;
}

export interface BooleanLiteral extends ASTNode {
    kind: 'BooleanLiteral';
    value: boolean;
}

export interface HexLiteral extends ASTNode {
    kind: 'HexLiteral';
    value: number;
    raw: string;
}

export interface BinLiteral extends ASTNode {
    kind: 'BinLiteral';
    value: number;
    raw: string;
}

export interface IdentifierExpr extends ASTNode {
    kind: 'IdentifierExpr';
    name: string;
}

export interface CallExpr extends ASTNode {
    kind: 'CallExpr';
    callee: Expression;
    args: Expression[];
}

export interface MemberExpr extends ASTNode {
    kind: 'MemberExpr';
    object: Expression;
    property: string;
}

export interface IndexExpr extends ASTNode {
    kind: 'IndexExpr';
    object: Expression;
    indices: Expression[];
}

export interface ParenExpr extends ASTNode {
    kind: 'ParenExpr';
    expression: Expression;
}

export type Expression =
    | BinaryExpr
    | UnaryExpr
    | IntegerLiteral
    | FloatLiteral
    | StringLiteral
    | BooleanLiteral
    | HexLiteral
    | BinLiteral
    | IdentifierExpr
    | CallExpr
    | MemberExpr
    | IndexExpr
    | ParenExpr;

// ─── Statements ──────────────────────────────────────────────────────────────

export interface ExpressionStmt extends ASTNode {
    kind: 'ExpressionStmt';
    expression: Expression;
}

export interface LabelStmt extends ASTNode {
    kind: 'LabelStmt';
    name: string;
}

export interface GotoStmt extends ASTNode {
    kind: 'GotoStmt';
    target: string;
}

export type ExitTarget = 'do' | 'for' | 'function' | 'property' | 'sub' | 'while';

export interface ExitStmt extends ASTNode {
    kind: 'ExitStmt';
    target: ExitTarget;
}

export interface IfBranch {
    condition: Expression;
    body: Statement[];
}

export interface IfStmt extends ASTNode {
    kind: 'IfStmt';
    condition: Expression;
    thenBody: Statement[];
    elseIfBranches: IfBranch[];
    elseBody?: Statement[];
    isInline: boolean;
}

export interface CaseClause {
    conditions: Expression[];
    body: Statement[];
}

export interface SelectCaseStmt extends ASTNode {
    kind: 'SelectCaseStmt';
    testExpr: Expression;
    cases: CaseClause[];
    defaultCase?: Statement[];
}

export interface ForStmt extends ASTNode {
    kind: 'ForStmt';
    init: Expression; // assignment expression (i = 0)
    to: Expression;
    step?: Expression;
    body: Statement[];
}

export interface WhileStmt extends ASTNode {
    kind: 'WhileStmt';
    condition: Expression;
    body: Statement[];
}

export enum DoLoopKind {
    Infinite = 'infinite',
    WhilePre = 'while_pre',
    UntilPre = 'until_pre',
    WhilePost = 'while_post',
    UntilPost = 'until_post',
}

export interface DoLoopStmt extends ASTNode {
    kind: 'DoLoopStmt';
    loopKind: DoLoopKind;
    condition?: Expression;
    body: Statement[];
}

export type Statement =
    | ExpressionStmt
    | LabelStmt
    | GotoStmt
    | ExitStmt
    | IfStmt
    | SelectCaseStmt
    | ForStmt
    | WhileStmt
    | DoLoopStmt
    | DimStmt
    | ConstDecl;

// ─── Parameters ──────────────────────────────────────────────────────────────

export enum PassMode {
    ByVal = 'byval',
    ByRef = 'byref',
}

export interface ParamDecl extends ASTNode {
    kind: 'ParamDecl';
    name: string;
    passMode: PassMode;
    typeRef?: TypeRefNode;
    arraySize?: number;
}

// ─── Declarations ────────────────────────────────────────────────────────────

export interface IncludeStmt extends ASTNode {
    kind: 'IncludeStmt';
    path: string;
    isPP: boolean; // includepp vs include
}

export interface VariableItem {
    name: string;
    dimensions?: Expression[];
}

export interface DimStmt extends ASTNode {
    kind: 'DimStmt';
    isPublic: boolean;
    isDeclare: boolean;
    variables: VariableItem[];
    typeRef?: TypeRefNode;
    initializer?: Expression;
    arrayInitializer?: ArrayLiteralNode;
}

export interface ArrayLiteralNode extends ASTNode {
    kind: 'ArrayLiteral';
    elements: (Expression | ArrayLiteralNode)[];
}

export interface ConstSubDecl {
    name: string;
    typeRef?: TypeRefNode;
    value: Expression;
    loc: SourceLocation;
}

export interface ConstDecl extends ASTNode {
    kind: 'ConstDecl';
    constants: ConstSubDecl[];
}

export interface EnumMemberDecl {
    name: string;
    value?: Expression;
    loc: SourceLocation;
}

export interface EnumDecl extends ASTNode {
    kind: 'EnumDecl';
    name: string;
    members: EnumMemberDecl[];
}

export interface TypeMemberDecl {
    name: string;
    arraySize?: Expression;
    typeRef: TypeRefNode;
    loc: SourceLocation;
}

export interface TypeDecl extends ASTNode {
    kind: 'TypeDecl';
    name: string;
    isPublic: boolean;
    members: TypeMemberDecl[];
}

export interface SubDecl extends ASTNode {
    kind: 'SubDecl';
    name: string;
    objectName?: string;
    isPublic: boolean;
    params: ParamDecl[];
    body: Statement[];
}

export interface FunctionDecl extends ASTNode {
    kind: 'FunctionDecl';
    name: string;
    objectName?: string;
    isPublic: boolean;
    params: ParamDecl[];
    returnType: TypeRefNode;
    body: Statement[];
}

export interface DeclareSubStmt extends ASTNode {
    kind: 'DeclareSubStmt';
    name: string;
    objectName?: string;
    params: ParamDecl[];
}

export interface DeclareFuncStmt extends ASTNode {
    kind: 'DeclareFuncStmt';
    name: string;
    objectName?: string;
    params: ParamDecl[];
    returnType: TypeRefNode;
}

export interface ObjectDecl extends ASTNode {
    kind: 'ObjectDecl';
    name: string;
}

export interface PropertyGetDecl {
    syscallNumber: number;
    syscallLib?: string;
    returnType: TypeRefNode;
}

export interface PropertySetDecl {
    syscallNumber: number;
    syscallLib?: string;
    params: ParamDecl[];
}

export interface PropertyDecl extends ASTNode {
    kind: 'PropertyDecl';
    objectName: string;
    propertyName: string;
    isBang: boolean;
    getter?: PropertyGetDecl;
    setter?: PropertySetDecl;
}

export interface SyscallDecl extends ASTNode {
    kind: 'SyscallDecl';
    syscallNumber: number;
    syscallLib?: string;
    objectName?: string;
    name: string;
    isInternal: boolean;
    params: ParamDecl[];
    returnType?: TypeRefNode;
}

export interface EventDecl extends ASTNode {
    kind: 'EventDecl';
    name: string;
    eventNumber: number;
    params: ParamDecl[];
}

// ─── Top-level ───────────────────────────────────────────────────────────────

export type TopLevelDeclaration =
    | IncludeStmt
    | EnumDecl
    | ConstDecl
    | DeclareSubStmt
    | DeclareFuncStmt
    | DimStmt
    | SubDecl
    | FunctionDecl
    | ObjectDecl
    | PropertyDecl
    | EventDecl
    | SyscallDecl
    | TypeDecl;

export interface Program extends ASTNode {
    kind: 'Program';
    declarations: TopLevelDeclaration[];
}
