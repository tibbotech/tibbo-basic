import { SourceLocation } from '../errors';
import * as AST from './nodes';

/* eslint-disable @typescript-eslint/no-var-requires */
const TibboBasicLexer = require('../../../language/TibboBasic/lib/TibboBasicLexer').TibboBasicLexer;
const TibboBasicParser = require('../../../language/TibboBasic/lib/TibboBasicParser').TibboBasicParser;

export class ASTBuilder {
    private fileName: string;

    constructor(fileName: string) {
        this.fileName = fileName;
    }

    private loc(ctx: any): SourceLocation {
        const token = ctx.start || ctx.symbol || ctx;
        return {
            file: this.fileName,
            line: token.line ?? 0,
            column: token.column ?? 0,
        };
    }

    buildProgram(tree: any): AST.Program {
        const declarations: AST.TopLevelDeclaration[] = [];
        if (!tree.children) return { kind: 'Program', declarations, loc: this.loc(tree) };
        for (const child of tree.children) {
            if (child.ruleIndex === TibboBasicParser.RULE_topLevelDeclaration) {
                const decl = this.visitTopLevelDeclaration(child);
                if (decl) declarations.push(decl);
            }
        }
        return { kind: 'Program', declarations, loc: this.loc(tree) };
    }

    private visitTopLevelDeclaration(ctx: any): AST.TopLevelDeclaration | null {
        const child = ctx.children?.[0];
        if (!child) return null;
        switch (child.ruleIndex) {
            case TibboBasicParser.RULE_includeStmt: return this.visitIncludeStmt(child);
            case TibboBasicParser.RULE_includeppStmt: return this.visitIncludeppStmt(child);
            case TibboBasicParser.RULE_enumerationStmt: return this.visitEnumerationStmt(child);
            case TibboBasicParser.RULE_constStmt: return this.visitConstStmt(child);
            case TibboBasicParser.RULE_declareSubStmt: return this.visitDeclareSubStmt(child);
            case TibboBasicParser.RULE_declareFuncStmt: return this.visitDeclareFuncStmt(child);
            case TibboBasicParser.RULE_declareVariableStmt: return this.visitDeclareVariableStmt(child);
            case TibboBasicParser.RULE_variableStmt: return this.visitVariableStmt(child);
            case TibboBasicParser.RULE_subStmt: return this.visitSubStmt(child);
            case TibboBasicParser.RULE_functionStmt: return this.visitFunctionStmt(child);
            case TibboBasicParser.RULE_objectDeclaration: return this.visitObjectDeclaration(child);
            case TibboBasicParser.RULE_propertyDefineStmt: return this.visitPropertyDefineStmt(child);
            case TibboBasicParser.RULE_eventDeclaration: return this.visitEventDeclaration(child);
            case TibboBasicParser.RULE_syscallDeclaration: return this.visitSyscallDeclaration(child);
            case TibboBasicParser.RULE_typeStmt: return this.visitTypeStmt(child);
            default: return null;
        }
    }

    // ─── Include ─────────────────────────────────────────────────────────────

    private visitIncludeStmt(ctx: any): AST.IncludeStmt {
        const pathToken = this.findToken(ctx, TibboBasicLexer.STRINGLITERAL);
        const raw = pathToken?.text ?? '';
        return { kind: 'IncludeStmt', path: raw.replace(/^[""`]|[""`]$/g, ''), isPP: false, loc: this.loc(ctx) };
    }

    private visitIncludeppStmt(ctx: any): AST.IncludeStmt {
        const pathToken = this.findToken(ctx, TibboBasicLexer.STRINGLITERAL);
        const raw = pathToken?.text ?? '';
        return { kind: 'IncludeStmt', path: raw.replace(/^[""`]|[""`]$/g, ''), isPP: true, loc: this.loc(ctx) };
    }

    // ─── Enum ────────────────────────────────────────────────────────────────

    private visitEnumerationStmt(ctx: any): AST.EnumDecl {
        const nameToken = this.findToken(ctx, TibboBasicLexer.IDENTIFIER);
        const members: AST.EnumMemberDecl[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_enumerationStmt_Constant) {
                members.push(this.visitEnumConstant(child));
            }
        }
        return { kind: 'EnumDecl', name: nameToken?.text ?? '', members, loc: this.loc(ctx) };
    }

    private visitEnumConstant(ctx: any): AST.EnumMemberDecl {
        const nameToken = this.findToken(ctx, TibboBasicLexer.IDENTIFIER);
        let value: AST.Expression | undefined;
        const eqIdx = this.findTokenIndex(ctx, TibboBasicLexer.EQ);
        if (eqIdx >= 0) {
            const exprCtx = this.findRule(ctx, TibboBasicParser.RULE_expression);
            if (exprCtx) value = this.visitExpression(exprCtx);
        }
        return { name: nameToken?.text ?? '', value, loc: this.loc(ctx) };
    }

    // ─── Const ───────────────────────────────────────────────────────────────

    private visitConstStmt(ctx: any): AST.ConstDecl {
        const constants: AST.ConstSubDecl[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_constSubStmt) {
                constants.push(this.visitConstSubStmt(child));
            }
        }
        return { kind: 'ConstDecl', constants, loc: this.loc(ctx) };
    }

    private visitConstSubStmt(ctx: any): AST.ConstSubDecl {
        const name = ctx.name?.text ?? this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        const typeRefCtx = this.findRule(ctx, TibboBasicParser.RULE_asTypeClause);
        const typeRef = typeRefCtx ? this.visitAsTypeClause(typeRefCtx) : undefined;
        const exprCtx = ctx.value ?? this.findRule(ctx, TibboBasicParser.RULE_expression);
        const value = exprCtx ? this.visitExpression(exprCtx) : { kind: 'IntegerLiteral' as const, value: 0, loc: this.loc(ctx) };
        return { name, typeRef, value, loc: this.loc(ctx) };
    }

    // ─── Declare ─────────────────────────────────────────────────────────────

    private visitDeclareSubStmt(ctx: any): AST.DeclareSubStmt {
        const name = ctx.name?.text ?? '';
        const identifiers = this.findAllTokens(ctx, TibboBasicLexer.IDENTIFIER);
        let objectName: string | undefined;
        if (this.findToken(ctx, TibboBasicLexer.DOT) && identifiers.length > 1) {
            objectName = identifiers[0]?.text;
        }
        const params = this.visitParamList(this.findRule(ctx, TibboBasicParser.RULE_paramList));
        return { kind: 'DeclareSubStmt', name, objectName, params, loc: this.loc(ctx) };
    }

    private visitDeclareFuncStmt(ctx: any): AST.DeclareFuncStmt {
        const name = ctx.name?.text ?? '';
        const identifiers = this.findAllTokens(ctx, TibboBasicLexer.IDENTIFIER);
        let objectName: string | undefined;
        if (this.findToken(ctx, TibboBasicLexer.DOT) && identifiers.length > 1) {
            objectName = identifiers[0]?.text;
        }
        const params = this.visitParamList(this.findRule(ctx, TibboBasicParser.RULE_paramList));
        const returnType = this.visitAsTypeClause(ctx.returnType ?? this.findRule(ctx, TibboBasicParser.RULE_asTypeClause));
        return { kind: 'DeclareFuncStmt', name, objectName, params, returnType, loc: this.loc(ctx) };
    }

    private visitDeclareVariableStmt(ctx: any): AST.DimStmt {
        const isPublic = this.hasVisibility(ctx);
        const listCtx = this.findRule(ctx, TibboBasicParser.RULE_variableListStmt);
        return this.buildDimStmt(listCtx, isPublic, true, ctx);
    }

    // ─── Variable / Dim ──────────────────────────────────────────────────────

    private visitVariableStmt(ctx: any): AST.DimStmt {
        const isPublic = this.hasVisibility(ctx);
        const listCtx = this.findRule(ctx, TibboBasicParser.RULE_variableListStmt);
        return this.buildDimStmt(listCtx, isPublic, false, ctx);
    }

    private buildDimStmt(listCtx: any, isPublic: boolean, isDeclare: boolean, parentCtx: any): AST.DimStmt {
        const variables: AST.VariableItem[] = [];
        let typeRef: AST.TypeRefNode | undefined;
        let initializer: AST.Expression | undefined;
        let arrayInitializer: AST.ArrayLiteralNode | undefined;

        if (listCtx) {
            for (const child of listCtx.children || []) {
                if (child.ruleIndex === TibboBasicParser.RULE_variableListItem) {
                    variables.push(this.visitVariableListItem(child));
                }
                if (child.ruleIndex === TibboBasicParser.RULE_asTypeClause) {
                    typeRef = this.visitAsTypeClause(child);
                }
                if (child.ruleIndex === TibboBasicParser.RULE_expression) {
                    initializer = this.visitExpression(child);
                }
                if (child.ruleIndex === TibboBasicParser.RULE_arrayLiteral) {
                    arrayInitializer = this.visitArrayLiteral(child);
                }
            }
        }

        return { kind: 'DimStmt', isPublic, isDeclare, variables, typeRef, initializer, arrayInitializer, loc: this.loc(parentCtx) };
    }

    private visitVariableListItem(ctx: any): AST.VariableItem {
        const name = this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        const dimensions: AST.Expression[] = [];
        const literalRules = this.findAllRules(ctx, TibboBasicParser.RULE_literal);
        for (const lit of literalRules) {
            dimensions.push(this.visitLiteral(lit));
        }
        return { name, dimensions: dimensions.length > 0 ? dimensions : undefined };
    }

    private visitArrayLiteral(ctx: any): AST.ArrayLiteralNode {
        const elements: (AST.Expression | AST.ArrayLiteralNode)[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_literal) {
                elements.push(this.visitLiteral(child));
            } else if (child.ruleIndex === TibboBasicParser.RULE_arrayLiteral) {
                elements.push(this.visitArrayLiteral(child));
            }
        }
        return { kind: 'ArrayLiteral', elements, loc: this.loc(ctx) };
    }

    // ─── Sub / Function ──────────────────────────────────────────────────────

    private visitSubStmt(ctx: any): AST.SubDecl {
        const isPublic = this.hasVisibility(ctx);
        const name = ctx.name?.text ?? '';
        const identifiers = this.findAllTokens(ctx, TibboBasicLexer.IDENTIFIER);
        let objectName: string | undefined;
        if (this.findToken(ctx, TibboBasicLexer.DOT)) {
            for (let i = 0; i < (ctx.children?.length ?? 0); i++) {
                const c = ctx.children[i];
                if (c.symbol?.type === TibboBasicLexer.DOT && i > 0) {
                    const prev = ctx.children[i - 1];
                    if (prev.symbol?.type === TibboBasicLexer.IDENTIFIER && prev.symbol.text !== name) {
                        objectName = prev.symbol.text;
                    }
                    break;
                }
            }
        }
        const params = this.visitParamList(this.findRule(ctx, TibboBasicParser.RULE_paramList));
        const body = this.visitBlock(this.findRule(ctx, TibboBasicParser.RULE_block));
        return { kind: 'SubDecl', name, objectName, isPublic, params, body, loc: this.loc(ctx) };
    }

    private visitFunctionStmt(ctx: any): AST.FunctionDecl {
        const isPublic = this.hasVisibility(ctx);
        const name = ctx.name?.text ?? '';
        let objectName: string | undefined;
        if (this.findToken(ctx, TibboBasicLexer.DOT)) {
            for (let i = 0; i < (ctx.children?.length ?? 0); i++) {
                const c = ctx.children[i];
                if (c.symbol?.type === TibboBasicLexer.DOT && i > 0) {
                    const prev = ctx.children[i - 1];
                    if (prev.symbol?.type === TibboBasicLexer.IDENTIFIER && prev.symbol.text !== name) {
                        objectName = prev.symbol.text;
                    }
                    break;
                }
            }
        }
        const params = this.visitParamList(this.findRule(ctx, TibboBasicParser.RULE_paramList));
        const returnType = this.visitAsTypeClause(ctx.returnType ?? this.findRule(ctx, TibboBasicParser.RULE_asTypeClause));
        const body = this.visitBlock(this.findRule(ctx, TibboBasicParser.RULE_block));
        return { kind: 'FunctionDecl', name, objectName, isPublic, params, returnType, body, loc: this.loc(ctx) };
    }

    // ─── Object / Property / Event / Syscall / Type ──────────────────────────

    private visitObjectDeclaration(ctx: any): AST.ObjectDecl {
        const name = this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        return { kind: 'ObjectDecl', name, loc: this.loc(ctx) };
    }

    private visitPropertyDefineStmt(ctx: any): AST.PropertyDecl {
        const objectName = ctx.object?.text ?? '';
        const propertyName = ctx.property?.text ?? '';
        const isBang = !!this.findToken(ctx, TibboBasicLexer.BANG);
        let getter: AST.PropertyGetDecl | undefined;
        let setter: AST.PropertySetDecl | undefined;

        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_propertyDefineStmt_InStmt) {
                const inner = child.children?.[0];
                if (inner?.ruleIndex === TibboBasicParser.RULE_propertyGetStmt) {
                    getter = this.visitPropertyGetStmt(inner);
                } else if (inner?.ruleIndex === TibboBasicParser.RULE_propertySetStmt) {
                    setter = this.visitPropertySetStmt(inner);
                }
            }
        }

        return { kind: 'PropertyDecl', objectName, propertyName, isBang, getter, setter, loc: this.loc(ctx) };
    }

    private visitPropertyGetStmt(ctx: any): AST.PropertyGetDecl {
        const intToken = this.findToken(ctx, TibboBasicLexer.INTEGERLITERAL);
        const syscallNumber = intToken ? parseInt(intToken.text, 10) : 0;
        const libToken = this.findToken(ctx, TibboBasicLexer.STRINGLITERAL);
        const syscallLib = libToken ? libToken.text.replace(/^[""`]|[""`]$/g, '') : undefined;
        const returnType = this.visitAsTypeClause(this.findRule(ctx, TibboBasicParser.RULE_asTypeClause));
        return { syscallNumber, syscallLib, returnType };
    }

    private visitPropertySetStmt(ctx: any): AST.PropertySetDecl {
        const intToken = this.findToken(ctx, TibboBasicLexer.INTEGERLITERAL);
        const syscallNumber = intToken ? parseInt(intToken.text, 10) : 0;
        const libToken = this.findToken(ctx, TibboBasicLexer.STRINGLITERAL);
        const syscallLib = libToken ? libToken.text.replace(/^[""`]|[""`]$/g, '') : undefined;
        const params = this.visitParamList(this.findRule(ctx, TibboBasicParser.RULE_paramList));
        return { syscallNumber, syscallLib, params };
    }

    private visitEventDeclaration(ctx: any): AST.EventDecl {
        const name = ctx.name?.text ?? '';
        const numToken = ctx.number ?? this.findToken(ctx, TibboBasicLexer.INTEGERLITERAL);
        const eventNumber = numToken ? parseInt(numToken.text, 10) : 0;
        const params = this.visitParamList(ctx.params ?? this.findRule(ctx, TibboBasicParser.RULE_paramList));
        return { kind: 'EventDecl', name, eventNumber, params, loc: this.loc(ctx) };
    }

    private visitSyscallDeclaration(ctx: any): AST.SyscallDecl {
        const intToken = this.findToken(ctx, TibboBasicLexer.INTEGERLITERAL);
        const syscallNumber = intToken ? parseInt(intToken.text, 10) : 0;
        const libToken = this.findToken(ctx, TibboBasicLexer.STRINGLITERAL);
        const syscallLib = libToken ? libToken.text.replace(/^[""`]|[""`]$/g, '') : undefined;

        const innerCtx = this.findRule(ctx, TibboBasicParser.RULE_syscallDeclarationInner);
        const internalCtx = this.findRule(ctx, TibboBasicParser.RULE_syscallInternalDeclarationInner);
        const isInternal = !!internalCtx;
        const actualCtx = innerCtx || internalCtx;

        let objectName: string | undefined;
        let name = '';
        let params: AST.ParamDecl[] = [];
        let returnType: AST.TypeRefNode | undefined;

        if (actualCtx) {
            objectName = actualCtx.object?.text;
            name = actualCtx.property?.text ?? '';

            if (isInternal) {
                const internalParamCtx = this.findRule(actualCtx, TibboBasicParser.RULE_syscallInternalParamList);
                params = this.visitInternalParamList(internalParamCtx);
            } else {
                params = this.visitParamList(this.findRule(actualCtx, TibboBasicParser.RULE_paramList));
            }
            const typeCtx = this.findRule(actualCtx, TibboBasicParser.RULE_asTypeClause);
            if (typeCtx) returnType = this.visitAsTypeClause(typeCtx);
        }

        return { kind: 'SyscallDecl', syscallNumber, syscallLib, objectName, name, isInternal, params, returnType, loc: this.loc(ctx) };
    }

    private visitTypeStmt(ctx: any): AST.TypeDecl {
        const isPublic = this.hasVisibility(ctx);
        const name = ctx.name?.text ?? '';
        const members: AST.TypeMemberDecl[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_typeStmtElement) {
                members.push(this.visitTypeStmtElement(child));
            }
        }
        return { kind: 'TypeDecl', name, isPublic, members, loc: this.loc(ctx) };
    }

    private visitTypeStmtElement(ctx: any): AST.TypeMemberDecl {
        const name = this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        const litCtx = this.findRule(ctx, TibboBasicParser.RULE_literal);
        const arraySize = litCtx ? this.visitLiteral(litCtx) : undefined;
        const typeRef = this.visitAsTypeClause(ctx.valueType ?? this.findRule(ctx, TibboBasicParser.RULE_asTypeClause));
        return { name, arraySize, typeRef, loc: this.loc(ctx) };
    }

    // ─── Block / Statements ──────────────────────────────────────────────────

    private visitBlock(ctx: any): AST.Statement[] {
        if (!ctx?.children) return [];
        const stmts: AST.Statement[] = [];
        for (const child of ctx.children) {
            if (child.ruleIndex === TibboBasicParser.RULE_lineLabel) {
                stmts.push(this.visitLineLabel(child));
            } else if (child.ruleIndex === TibboBasicParser.RULE_statement) {
                const s = this.visitStatement(child);
                if (s) stmts.push(s);
            }
        }
        return stmts;
    }

    private visitStatement(ctx: any): AST.Statement | null {
        if (!ctx?.children) return null;
        const child = ctx.children[0];
        if (!child) return null;

        switch (child.ruleIndex) {
            case TibboBasicParser.RULE_lineLabel:
                return this.visitLineLabel(child);
            case TibboBasicParser.RULE_constStmt:
                return this.visitConstStmt(child);
            case TibboBasicParser.RULE_doLoopStmt:
                return this.visitDoLoopStmt(child);
            case TibboBasicParser.RULE_forNextStmt:
                return this.visitForNextStmt(child);
            case TibboBasicParser.RULE_jumpStmt:
                return this.visitJumpStmt(child);
            case TibboBasicParser.RULE_ifThenElseStmt:
                return this.visitIfThenElseStmt(child);
            case TibboBasicParser.RULE_selectCaseStmt:
                return this.visitSelectCaseStmt(child);
            case TibboBasicParser.RULE_variableStmt:
                return this.visitVariableStmt(child);
            case TibboBasicParser.RULE_whileWendStmt:
                return this.visitWhileWendStmt(child);
            case TibboBasicParser.RULE_expression:
                return { kind: 'ExpressionStmt', expression: this.visitExpression(child), loc: this.loc(child) };
            default:
                return null;
        }
    }

    private visitLineLabel(ctx: any): AST.LabelStmt {
        const name = this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        return { kind: 'LabelStmt', name, loc: this.loc(ctx) };
    }

    private visitJumpStmt(ctx: any): AST.GotoStmt | AST.ExitStmt {
        const child = ctx.children?.[0];
        if (child?.ruleIndex === TibboBasicParser.RULE_goToStmt) {
            return this.visitGoToStmt(child);
        }
        if (child?.ruleIndex === TibboBasicParser.RULE_exitStmt) {
            return this.visitExitStmt(child);
        }
        return this.visitExitStmt(ctx);
    }

    private visitGoToStmt(ctx: any): AST.GotoStmt {
        const target = this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        return { kind: 'GotoStmt', target, loc: this.loc(ctx) };
    }

    private visitExitStmt(ctx: any): AST.ExitStmt {
        const child = ctx.children?.[0];
        const type = child?.symbol?.type;
        let target: AST.ExitTarget = 'sub';
        if (type === TibboBasicLexer.EXIT_DO) target = 'do';
        else if (type === TibboBasicLexer.EXIT_FOR) target = 'for';
        else if (type === TibboBasicLexer.EXIT_FUNCTION) target = 'function';
        else if (type === TibboBasicLexer.EXIT_PROPERTY) target = 'property';
        else if (type === TibboBasicLexer.EXIT_SUB) target = 'sub';
        else if (type === TibboBasicLexer.EXIT_WHILE) target = 'while';
        return { kind: 'ExitStmt', target, loc: this.loc(ctx) };
    }

    // ─── If/Then/Else ────────────────────────────────────────────────────────

    private visitIfThenElseStmt(ctx: any): AST.IfStmt {
        const ctxName = ctx.constructor?.name ?? '';
        if (ctxName.includes('InlineIfThenElse') || ctxName === 'InlineIfThenElseContext') {
            return this.visitInlineIfThenElse(ctx);
        }
        return this.visitBlockIfThenElse(ctx);
    }

    private visitInlineIfThenElse(ctx: any): AST.IfStmt {
        const exprs = this.findAllRules(ctx, TibboBasicParser.RULE_expression);
        const stmts = this.findAllRules(ctx, TibboBasicParser.RULE_statement);
        const condition = exprs[0] ? this.visitExpression(exprs[0]) : this.makeZeroLiteral(ctx);
        const thenBody: AST.Statement[] = [];
        if (stmts[0]) {
            const s = this.visitStatement(stmts[0]);
            if (s) thenBody.push(s);
        }
        let elseBody: AST.Statement[] | undefined;
        if (stmts.length > 1) {
            elseBody = [];
            const s = this.visitStatement(stmts[1]);
            if (s) elseBody.push(s);
        }
        return { kind: 'IfStmt', condition, thenBody, elseIfBranches: [], elseBody, isInline: true, loc: this.loc(ctx) };
    }

    private visitBlockIfThenElse(ctx: any): AST.IfStmt {
        const children = ctx.children || [];
        const condition = this.visitExpression(this.findRule(ctx, TibboBasicParser.RULE_expression)!);
        const blocks = this.findAllRules(ctx, TibboBasicParser.RULE_block);
        const thenBody = blocks[0] ? this.visitBlock(blocks[0]) : [];

        const elseIfBranches: AST.IfBranch[] = [];
        let elseBody: AST.Statement[] | undefined;

        const ifConditions = this.findAllRules(ctx, TibboBasicParser.RULE_ifConditionStmt);
        let blockIdx = 1;
        for (const cond of ifConditions) {
            const condExpr = this.visitExpression(this.findRule(cond, TibboBasicParser.RULE_expression)!);
            const body = blocks[blockIdx] ? this.visitBlock(blocks[blockIdx]) : [];
            elseIfBranches.push({ condition: condExpr, body });
            blockIdx++;
        }

        for (const child of children) {
            if (child.symbol?.type === TibboBasicLexer.ELSE) {
                elseBody = blocks[blockIdx] ? this.visitBlock(blocks[blockIdx]) : [];
                break;
            }
        }

        return { kind: 'IfStmt', condition, thenBody, elseIfBranches, elseBody, isInline: false, loc: this.loc(ctx) };
    }

    // ─── Select Case ─────────────────────────────────────────────────────────

    private visitSelectCaseStmt(ctx: any): AST.SelectCaseStmt {
        const exprCtx = this.findRule(ctx, TibboBasicParser.RULE_expression)!;
        const testExpr = this.visitExpression(exprCtx);
        const cases: AST.CaseClause[] = [];
        let defaultCase: AST.Statement[] | undefined;

        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_sC_Case) {
                const conditions: AST.Expression[] = [];
                for (const cc of child.children || []) {
                    if (cc.ruleIndex === TibboBasicParser.RULE_sC_Cond) {
                        const e = this.findRule(cc, TibboBasicParser.RULE_expression);
                        if (e) conditions.push(this.visitExpression(e));
                    }
                }
                const block = this.findRule(child, TibboBasicParser.RULE_block);
                cases.push({ conditions, body: this.visitBlock(block) });
            } else if (child.ruleIndex === TibboBasicParser.RULE_sC_Default) {
                const block = this.findRule(child, TibboBasicParser.RULE_block);
                defaultCase = this.visitBlock(block);
            }
        }

        return { kind: 'SelectCaseStmt', testExpr, cases, defaultCase, loc: this.loc(ctx) };
    }

    // ─── Loops ───────────────────────────────────────────────────────────────

    private visitForNextStmt(ctx: any): AST.ForStmt {
        const exprs = this.findAllRules(ctx, TibboBasicParser.RULE_expression);
        const init = exprs[0] ? this.visitExpression(exprs[0]) : this.makeZeroLiteral(ctx);
        const to = exprs[1] ? this.visitExpression(exprs[1]) : this.makeZeroLiteral(ctx);
        const step = ctx.step ? this.visitExpression(ctx.step) : undefined;
        const body = this.visitBlock(this.findRule(ctx, TibboBasicParser.RULE_block));
        return { kind: 'ForStmt', init, to, step, body, loc: this.loc(ctx) };
    }

    private visitWhileWendStmt(ctx: any): AST.WhileStmt {
        const exprCtx = this.findRule(ctx, TibboBasicParser.RULE_expression)!;
        const condition = this.visitExpression(exprCtx);
        const body = this.visitBlock(this.findRule(ctx, TibboBasicParser.RULE_block));
        return { kind: 'WhileStmt', condition, body, loc: this.loc(ctx) };
    }

    private visitDoLoopStmt(ctx: any): AST.DoLoopStmt {
        const children = ctx.children || [];
        const body = this.visitBlock(this.findRule(ctx, TibboBasicParser.RULE_block));
        let loopKind = AST.DoLoopKind.Infinite;
        let condition: AST.Expression | undefined;

        if (ctx.condition) {
            condition = this.visitExpression(ctx.condition);
            const hasWhileBefore = children.length > 1 && children[1]?.symbol?.type === TibboBasicLexer.WHILE;
            const hasUntilBefore = children.length > 1 && children[1]?.symbol?.type === TibboBasicLexer.UNTIL;

            if (hasWhileBefore) loopKind = AST.DoLoopKind.WhilePre;
            else if (hasUntilBefore) loopKind = AST.DoLoopKind.UntilPre;
            else {
                const loopIdx = children.findIndex((c: any) => c.symbol?.type === TibboBasicLexer.LOOP);
                if (loopIdx >= 0 && loopIdx + 1 < children.length) {
                    const afterLoop = children[loopIdx + 1];
                    if (afterLoop?.symbol?.type === TibboBasicLexer.WHILE) loopKind = AST.DoLoopKind.WhilePost;
                    else if (afterLoop?.symbol?.type === TibboBasicLexer.UNTIL) loopKind = AST.DoLoopKind.UntilPost;
                }
            }
        }

        return { kind: 'DoLoopStmt', loopKind, condition, body, loc: this.loc(ctx) };
    }

    // ─── Expressions ─────────────────────────────────────────────────────────

    visitExpression(ctx: any): AST.Expression {
        if (!ctx) return this.makeZeroLiteral({ start: { line: 0, column: 0 } });
        if (ctx.ruleIndex === TibboBasicParser.RULE_expression) return this.visitExpressionRule(ctx);
        if (ctx.ruleIndex === TibboBasicParser.RULE_unaryExpression) return this.visitUnaryExpression(ctx);
        if (ctx.ruleIndex === TibboBasicParser.RULE_postfixExpression) return this.visitPostfixExpression(ctx);
        if (ctx.ruleIndex === TibboBasicParser.RULE_primaryExpression) return this.visitPrimaryExpression(ctx);
        if (ctx.ruleIndex === TibboBasicParser.RULE_literal) return this.visitLiteral(ctx);
        if (ctx.symbol) return this.visitTerminalAsExpr(ctx);
        if (ctx.children?.length === 1) return this.visitExpression(ctx.children[0]);
        return this.makeZeroLiteral(ctx);
    }

    private visitExpressionRule(ctx: any): AST.Expression {
        const children = ctx.children || [];

        if (children.length === 1) {
            return this.visitExpression(children[0]);
        }

        // parenthesized: LPAREN expr RPAREN
        if (children.length === 3 && children[0]?.symbol?.type === TibboBasicLexer.LPAREN
            && children[2]?.symbol?.type === TibboBasicLexer.RPAREN) {
            return { kind: 'ParenExpr', expression: this.visitExpression(children[1]), loc: this.loc(ctx) };
        }

        // binary: expr op expr (possibly with trailing NEWLINE*)
        if (ctx.op) {
            const left = this.visitExpression(children[0]);
            const right = this.visitExpression(children[2] ?? children[children.length - 1]);
            const op = this.tokenToBinaryOp(ctx.op.type);
            return { kind: 'BinaryExpr', op, left, right, loc: this.loc(ctx) };
        }

        // expr LPAREN expr RPAREN => function call or indexing
        if (children.length >= 4 && children[1]?.symbol?.type === TibboBasicLexer.LPAREN) {
            const callee = this.visitExpression(children[0]);
            const arg = this.visitExpression(children[2]);
            return { kind: 'CallExpr', callee, args: [arg], loc: this.loc(ctx) };
        }

        // fallback: walk children for first meaningful node
        if (children.length === 2) {
            return this.visitExpression(children[0]);
        }

        return this.visitExpression(children[0]);
    }

    private visitUnaryExpression(ctx: any): AST.Expression {
        const children = ctx.children || [];
        if (children.length === 1) return this.visitExpression(children[0]);
        if (children.length === 2) {
            const opCtx = children[0];
            const operand = this.visitExpression(children[1]);
            let op = AST.UnaryOp.Neg;
            if (opCtx.children?.[0]?.symbol?.type === TibboBasicLexer.NOT) op = AST.UnaryOp.Not;
            return { kind: 'UnaryExpr', op, operand, loc: this.loc(ctx) };
        }
        return this.visitExpression(children[0]);
    }

    private visitPostfixExpression(ctx: any): AST.Expression {
        const children = ctx.children || [];
        if (children.length === 0) return this.makeZeroLiteral(ctx);

        // postfixExpression DOT property postfix*
        if (children.length >= 3 && children[1]?.symbol?.type === TibboBasicLexer.DOT) {
            let obj = this.visitExpression(children[0]);
            const prop = ctx.property?.text ?? children[2]?.symbol?.text ?? '';
            let expr: AST.Expression = { kind: 'MemberExpr', object: obj, property: prop, loc: this.loc(ctx) };

            for (let i = 3; i < children.length; i++) {
                if (children[i].ruleIndex === TibboBasicParser.RULE_postfix) {
                    expr = this.applyPostfix(expr, children[i]);
                }
            }
            return expr;
        }

        // primaryExpression postfix*
        let expr = this.visitExpression(children[0]);
        for (let i = 1; i < children.length; i++) {
            if (children[i].ruleIndex === TibboBasicParser.RULE_postfix) {
                expr = this.applyPostfix(expr, children[i]);
            }
        }
        return expr;
    }

    private applyPostfix(expr: AST.Expression, postfixCtx: any): AST.Expression {
        const argListCtx = this.findRule(postfixCtx, TibboBasicParser.RULE_argList);
        if (argListCtx) {
            const args: AST.Expression[] = [];
            for (const child of argListCtx.children || []) {
                if (child.ruleIndex === TibboBasicParser.RULE_arg) {
                    const e = this.findRule(child, TibboBasicParser.RULE_expression);
                    if (e) args.push(this.visitExpression(e));
                }
            }
            return { kind: 'CallExpr', callee: expr, args, loc: this.loc(postfixCtx) };
        }
        return expr;
    }

    private visitPrimaryExpression(ctx: any): AST.Expression {
        const children = ctx.children || [];
        if (children.length === 1) {
            return this.visitExpression(children[0]);
        }
        // LPAREN expr RPAREN
        if (children.length === 3 && children[0]?.symbol?.type === TibboBasicLexer.LPAREN) {
            return { kind: 'ParenExpr', expression: this.visitExpression(children[1]), loc: this.loc(ctx) };
        }
        return this.visitExpression(children[0]);
    }

    private visitLiteral(ctx: any): AST.Expression {
        const children = ctx.children || [];
        if (children.length === 0 && ctx.symbol) {
            return this.visitTerminalAsExpr(ctx);
        }

        const first = children[0];
        if (!first) return this.makeZeroLiteral(ctx);

        if (first.symbol) {
            const type = first.symbol.type;
            const text: string = first.symbol.text;

            if (type === TibboBasicLexer.HEXLITERAL) {
                return { kind: 'HexLiteral', value: parseInt(text.substring(2), 16), raw: text, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.BINLITERAL) {
                return { kind: 'BinLiteral', value: parseInt(text.substring(2), 2), raw: text, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.STRINGLITERAL || type === TibboBasicLexer.TemplateStringLiteral) {
                return { kind: 'StringLiteral', value: text.substring(1, text.length - 1), loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.TRUE) {
                return { kind: 'BooleanLiteral', value: true, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.FALSE) {
                return { kind: 'BooleanLiteral', value: false, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.IDENTIFIER) {
                return { kind: 'IdentifierExpr', name: text, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.PLUS || type === TibboBasicLexer.MINUS) {
                // signed numeric literal
                const sign = type === TibboBasicLexer.MINUS ? -1 : 1;
                const numParts = children.slice(1).map((c: any) => c.symbol?.text ?? '').join('');
                const numValue = numParts.includes('.') ? parseFloat(numParts) * sign : parseInt(numParts, 10) * sign;
                if (numParts.includes('.')) {
                    return { kind: 'FloatLiteral', value: numValue, loc: this.loc(ctx) };
                }
                return { kind: 'IntegerLiteral', value: numValue, loc: this.loc(ctx) };
            }
            if (type === TibboBasicLexer.INTEGERLITERAL) {
                const allText = children.map((c: any) => c.symbol?.text ?? '').join('');
                if (allText.includes('.')) {
                    return { kind: 'FloatLiteral', value: parseFloat(allText), loc: this.loc(ctx) };
                }
                return { kind: 'IntegerLiteral', value: parseInt(allText, 10), loc: this.loc(ctx) };
            }
        }

        return this.makeZeroLiteral(ctx);
    }

    private visitTerminalAsExpr(ctx: any): AST.Expression {
        const type = ctx.symbol?.type;
        const text = ctx.symbol?.text ?? '';

        if (type === TibboBasicLexer.IDENTIFIER) {
            return { kind: 'IdentifierExpr', name: text, loc: this.loc(ctx) };
        }
        if (type === TibboBasicLexer.INTEGERLITERAL) {
            return { kind: 'IntegerLiteral', value: parseInt(text, 10), loc: this.loc(ctx) };
        }
        if (type === TibboBasicLexer.STRINGLITERAL) {
            return { kind: 'StringLiteral', value: text.substring(1, text.length - 1), loc: this.loc(ctx) };
        }
        if (type === TibboBasicLexer.TRUE) {
            return { kind: 'BooleanLiteral', value: true, loc: this.loc(ctx) };
        }
        if (type === TibboBasicLexer.FALSE) {
            return { kind: 'BooleanLiteral', value: false, loc: this.loc(ctx) };
        }
        if (type === TibboBasicLexer.HEXLITERAL) {
            return { kind: 'HexLiteral', value: parseInt(text.substring(2), 16), raw: text, loc: this.loc(ctx) };
        }

        return { kind: 'IdentifierExpr', name: text, loc: this.loc(ctx) };
    }

    // ─── Type references ─────────────────────────────────────────────────────

    private visitAsTypeClause(ctx: any): AST.TypeRefNode {
        if (!ctx) {
            return {
                kind: 'TypeRef',
                typeName: { kind: 'BaseType', baseType: AST.BaseTypeKind.Byte, loc: { file: this.fileName, line: 0, column: 0 } },
                isEnum: false,
                loc: { file: this.fileName, line: 0, column: 0 },
            };
        }
        const isEnum = !!this.findToken(ctx, TibboBasicLexer.ENUM);
        const typeCtx = this.findRule(ctx, TibboBasicParser.RULE_type);
        const typeName = typeCtx ? this.visitType(typeCtx) : this.visitType(ctx);
        return { kind: 'TypeRef', typeName, isEnum, loc: this.loc(ctx) };
    }

    private visitType(ctx: any): AST.BaseTypeNode | AST.ComplexTypeNode {
        const baseCtx = this.findRule(ctx, TibboBasicParser.RULE_baseType);
        if (baseCtx) return this.visitBaseType(baseCtx);
        const complexCtx = this.findRule(ctx, TibboBasicParser.RULE_complexType);
        if (complexCtx) return this.visitComplexType(complexCtx);
        // Fallback: try parsing children
        if (ctx.children?.length > 0) {
            const first = ctx.children[0];
            if (first.ruleIndex === TibboBasicParser.RULE_baseType) return this.visitBaseType(first);
            if (first.ruleIndex === TibboBasicParser.RULE_complexType) return this.visitComplexType(first);
        }
        return { kind: 'ComplexType', parts: [ctx.getText?.() ?? ''], loc: this.loc(ctx) };
    }

    private visitBaseType(ctx: any): AST.BaseTypeNode {
        const children = ctx.children || [];
        const first = children[0];
        const keyword = first?.symbol?.type;
        const baseType = this.tokenToBaseType(keyword);

        let stringSize: AST.Expression | undefined;
        if (baseType === AST.BaseTypeKind.String) {
            const exprCtx = this.findRule(ctx, TibboBasicParser.RULE_expression);
            if (exprCtx) stringSize = this.visitExpression(exprCtx);
        }

        return { kind: 'BaseType', baseType, stringSize, loc: this.loc(ctx) };
    }

    private visitComplexType(ctx: any): AST.ComplexTypeNode {
        const parts: string[] = [];
        for (const child of ctx.children || []) {
            if (child.symbol?.type === TibboBasicLexer.IDENTIFIER) {
                parts.push(child.symbol.text);
            }
        }
        return { kind: 'ComplexType', parts, loc: this.loc(ctx) };
    }

    // ─── Params ──────────────────────────────────────────────────────────────

    private visitParamList(ctx: any): AST.ParamDecl[] {
        if (!ctx) return [];
        const params: AST.ParamDecl[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_param) {
                params.push(this.visitParam(child));
            }
        }
        return params;
    }

    private visitParam(ctx: any): AST.ParamDecl {
        const name = ctx.name?.text ?? this.findToken(ctx, TibboBasicLexer.IDENTIFIER)?.text ?? '';
        let passMode = AST.PassMode.ByVal;
        if (this.findToken(ctx, TibboBasicLexer.BYREF)) passMode = AST.PassMode.ByRef;
        const typeCtx = ctx.valueType ?? this.findRule(ctx, TibboBasicParser.RULE_asTypeClause);
        const typeRef = typeCtx ? this.visitAsTypeClause(typeCtx) : undefined;
        const intToken = this.findToken(ctx, TibboBasicLexer.INTEGERLITERAL);
        const arraySize = intToken ? parseInt(intToken.text, 10) : undefined;
        return { kind: 'ParamDecl', name, passMode, typeRef, arraySize, loc: this.loc(ctx) };
    }

    private visitInternalParamList(ctx: any): AST.ParamDecl[] {
        if (!ctx) return [];
        const params: AST.ParamDecl[] = [];
        for (const child of ctx.children || []) {
            if (child.ruleIndex === TibboBasicParser.RULE_paramInternal) {
                const name = this.findToken(child, TibboBasicLexer.IDENTIFIER)?.text ?? '';
                let passMode = AST.PassMode.ByVal;
                if (this.findToken(child, TibboBasicLexer.BYREF)) passMode = AST.PassMode.ByRef;
                const typeCtx = this.findRule(child, TibboBasicParser.RULE_asTypeClause);
                const typeRef = typeCtx ? this.visitAsTypeClause(typeCtx) : undefined;
                params.push({ kind: 'ParamDecl', name, passMode, typeRef, loc: this.loc(child) });
            }
        }
        return params;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private hasVisibility(ctx: any): boolean {
        return !!this.findRule(ctx, TibboBasicParser.RULE_visibility);
    }

    private findToken(ctx: any, tokenType: number): any {
        if (!ctx?.children) return null;
        for (const child of ctx.children) {
            if (child.symbol?.type === tokenType) return child.symbol;
        }
        return null;
    }

    private findTokenIndex(ctx: any, tokenType: number): number {
        if (!ctx?.children) return -1;
        for (let i = 0; i < ctx.children.length; i++) {
            if (ctx.children[i].symbol?.type === tokenType) return i;
        }
        return -1;
    }

    private findAllTokens(ctx: any, tokenType: number): any[] {
        const result: any[] = [];
        if (!ctx?.children) return result;
        for (const child of ctx.children) {
            if (child.symbol?.type === tokenType) result.push(child.symbol);
        }
        return result;
    }

    private findRule(ctx: any, ruleIndex: number): any {
        if (!ctx?.children) return null;
        for (const child of ctx.children) {
            if (child.ruleIndex === ruleIndex) return child;
        }
        return null;
    }

    private findAllRules(ctx: any, ruleIndex: number): any[] {
        const result: any[] = [];
        if (!ctx?.children) return result;
        for (const child of ctx.children) {
            if (child.ruleIndex === ruleIndex) result.push(child);
        }
        return result;
    }

    private tokenToBinaryOp(tokenType: number): AST.BinaryOp {
        switch (tokenType) {
            case TibboBasicLexer.PLUS: return AST.BinaryOp.Add;
            case TibboBasicLexer.MINUS: return AST.BinaryOp.Sub;
            case TibboBasicLexer.MULT: return AST.BinaryOp.Mul;
            case TibboBasicLexer.DIV: return AST.BinaryOp.Div;
            case TibboBasicLexer.MOD: return AST.BinaryOp.Mod;
            case TibboBasicLexer.AND: return AST.BinaryOp.And;
            case TibboBasicLexer.OR: return AST.BinaryOp.Or;
            case TibboBasicLexer.XOR: return AST.BinaryOp.Xor;
            case TibboBasicLexer.SHL: return AST.BinaryOp.Shl;
            case TibboBasicLexer.SHR: return AST.BinaryOp.Shr;
            case TibboBasicLexer.NOT: return AST.BinaryOp.Not;
            case TibboBasicLexer.EQ: return AST.BinaryOp.Eq;
            case TibboBasicLexer.NEQ: return AST.BinaryOp.Neq;
            case TibboBasicLexer.LT: return AST.BinaryOp.Lt;
            case TibboBasicLexer.GT: return AST.BinaryOp.Gt;
            case TibboBasicLexer.LEQ: return AST.BinaryOp.Leq;
            case TibboBasicLexer.GEQ: return AST.BinaryOp.Geq;
            default: return AST.BinaryOp.Add;
        }
    }

    private tokenToBaseType(tokenType: number): AST.BaseTypeKind {
        switch (tokenType) {
            case TibboBasicLexer.BOOLEAN: return AST.BaseTypeKind.Boolean;
            case TibboBasicLexer.CHAR: return AST.BaseTypeKind.Char;
            case TibboBasicLexer.BYTE: return AST.BaseTypeKind.Byte;
            case TibboBasicLexer.SHORT: return AST.BaseTypeKind.Short;
            case TibboBasicLexer.WORD: return AST.BaseTypeKind.Word;
            case TibboBasicLexer.INTEGER: return AST.BaseTypeKind.Integer;
            case TibboBasicLexer.LONG: return AST.BaseTypeKind.Long;
            case TibboBasicLexer.DWORD: return AST.BaseTypeKind.Dword;
            case TibboBasicLexer.FLOAT: return AST.BaseTypeKind.Float;
            case TibboBasicLexer.REAL: return AST.BaseTypeKind.Real;
            case TibboBasicLexer.STRING: return AST.BaseTypeKind.String;
            default: return AST.BaseTypeKind.Byte;
        }
    }

    private makeZeroLiteral(ctx: any): AST.IntegerLiteral {
        return { kind: 'IntegerLiteral', value: 0, loc: this.loc(ctx) };
    }
}
