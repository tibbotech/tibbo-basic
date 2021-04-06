import fs = require('fs');
// import path = require('path');
// import ini = require('ini');
import TibboBasicErrorListener from './TibboBasicErrorListener';
// import { CommonToken } from 'antlr4/Token';
import { TBObject, TBEnum, TBFunction, TBConst, TBVariable, TBScope, TBSyscall, TBType, TBSyntaxError, TBEvent, TBRange, TBSymbol } from './types';
import { CommonToken } from 'antlr4/Token';
import { TerminalNode } from 'antlr4/tree/Tree';
import { CommonTokenStream } from 'antlr4/CommonTokenStream';
import path = require('path');

const antlr4 = require('antlr4');
const TibboBasicLexer = require('../language/TibboBasic/lib/TibboBasicLexer').TibboBasicLexer;
const TibboBasicParser = require('../language/TibboBasic/lib/TibboBasicParser').TibboBasicParser;
const TibboBasicParserListener = require('../language/TibboBasic/lib/TibboBasicParserListener').TibboBasicParserListener;

export default class TibboBasicTranspiler {

    output = '';
    lines: string[] = [];
    currentLine: string = '';

    parseFile(contents: string): string {
        this.output = '';
        this.lines = [];
        this.lines = contents.split('\n');

        const chars = new antlr4.InputStream(contents);
        const lexer = new TibboBasicLexer(chars);
        const tokens = new antlr4.CommonTokenStream(lexer);
        const parser = new TibboBasicParser(tokens);
        parser.buildParseTrees = true;
        const errorListener = new TibboBasicErrorListener();
        lexer.removeErrorListeners();
        // lexer.addErrorListener(errorListener);
        parser.removeErrorListeners();
        parser.addErrorListener(errorListener);
        const tree = parser.startRule();

        const listener = new ParserListener(this);
        antlr4.tree.ParseTreeWalker.DEFAULT.walk(listener, tree);

        for (let i = 0; i < tokens.tokens.length; i++) {
            const token = tokens.tokens[i] as CommonToken;
            if (token.channel == TibboBasicLexer.COMMENTS_CHANNEL) {
                // add comment to line
                let comment = token.text.substr(1);
                let line = token.line - 1;
                if (this.lines[line].indexOf("'") >= 0) {

                    let res = this.lines[line].search(/\S|$/);
                    this.lines[line] = this.lines[line].substr(0, res) + '//' + comment;
                }
                else {
                    this.lines[line] += '//' + comment;
                }
            }
        }
        for (let i = 0; i < this.lines.length; i++) {
            if (this.lines[i].trim().indexOf('#') == 0) {
                let content = this.replaceDirective(this.lines[i]);
                this.lines[i] = content;
            }
        }


        this.output = this.lines.join('\r\n');
        return this.output;
    }

    replaceDirective(content: string) {
        let index = 0;
        while (index < content.length) {
            if (content.substr(index, 1) == '=') {
                content = content.substr(0, index) + '==' + content.substr(index + 1);
                index += 1;
            }
            else if (content.substr(index, 2) == '<>') {
                content = content.substr(0, index) + '!=' + content.substr(index + 2);
                index += 1;
            }
            else if (content.substr(index, 2).toLowerCase() == 'or') {
                content = content.substr(0, index) + '||' + content.substr(index + 2);
                index += 1;
            }
            else if (content.substr(index, 3).toLowerCase() == 'and') {
                content = content.substr(0, index) + '&&' + content.substr(index + 3);
                index += 2;
            }

            index++;
        }
        return content;
    }

    addCode(code: string) {
        this.currentLine += code;
    }

    writeLine(line: number) {
        let res = this.lines[line - 1].search(/\S|$/);
        this.lines[line - 1] = this.lines[line - 1].substr(0, res) + this.currentLine;
        this.currentLine = '';
    }

}


class ParserListener extends TibboBasicParserListener {

    transpiler: TibboBasicTranspiler;
    currentObject?: string;
    currentProperty?: string;
    scopeStack: Array<TBScope> = [];
    currentParams: string[] = [];
    isDeclaration: boolean = false;
    currentFunction: any;

    constructor(transpiler: TibboBasicTranspiler) {
        super();
        this.transpiler = transpiler;
    }

    convertVariableType(variableType: string) {
        let valueType = variableType;
        switch (variableType) {
            case 'byte':
                valueType = 'unsigned char';
                break;
            case 'integer':
                valueType = 'int';
                break;
            case 'word':
                valueType = 'unsigned int';
                break;
            case 'dword':
                valueType = 'unsigned long';
                break;
            case 'real':
                valueType = 'float';
                break;
            case 'boolean':
                valueType = 'bool';
                break;

        }
        return valueType;
    }

    enterIncludeStmt(ctx: any) {
        let fileName = ctx.children[1].getText();
        let parts = fileName.split('.');
        parts[1] = 'th"';
        fileName = parts.join('.');
        this.transpiler.addCode(`#include ${fileName}`);
        this.transpiler.writeLine(ctx.start.line);
    }

    enterSubStmt(ctx: any) {
        this.transpiler.addCode(`void ${ctx.name.text}`);
    }

    enterParamList(ctx: any) {
        this.currentParams = [];
    }

    enterParam(ctx: any) {
        let valueType = this.convertVariableType(ctx.valueType.valueType.getText());
        let paramName = ctx.name.text;
        if (ctx.children[0].symbol.type == TibboBasicLexer.BYREF) {
            paramName = '*' + paramName;
        }

        this.currentParams.push(`${valueType} ${paramName}`);
    }

    exitParamList(ctx: any) {
        if (!this.isDeclaration) {
            this.transpiler.addCode(`(${this.currentParams.join(', ')}) {`);
        }
        else {
            this.transpiler.addCode(`(${this.currentParams.join(', ')});`);
        }
        this.transpiler.writeLine(ctx.start.line);
    }

    exitSubStmt(ctx: any) {
        this.transpiler.addCode('}');
        this.transpiler.writeLine(ctx.stop.line);
        this.isDeclaration = false;
    }

    enterFunctionStmt(ctx: any) {
        this.isDeclaration = false;
        const returnType = ctx.returnType.valueType.getText();
        this.transpiler.addCode(`${returnType} ${ctx.name.text}`)
    }

    exitFunctionStmt(ctx: any) {
        this.transpiler.addCode('}');
        this.transpiler.writeLine(ctx.stop.line);
        this.isDeclaration = false;
    }

    enterDeclareSubStmt(ctx: any) {
        this.isDeclaration = true;
        this.transpiler.addCode(`void ${ctx.name.text}`)
    }

    enterDeclareFuncStmt(ctx: any) {
        this.isDeclaration = true;
        const returnType = ctx.returnType.valueType.getText();
        this.transpiler.addCode(`${returnType} ${ctx.name.text}`)
    }

    enterDeclareVariableStmt(ctx: any) {
        this.transpiler.addCode('extern ');
    }

    enterVariableListStmt(ctx: any) {
        const variables: string[] = [];
        for (let i = 0; i < ctx.children.length; i++) {
            const item = ctx.children[i];
            if (item.ruleIndex == TibboBasicParser.RULE_variableListItem) {
                let exp = item.children[0].getText();
                if (item.children.length > 1) {
                    exp += `(${item.children[2].getText()})`
                }
                variables.push(exp);
            }
        }

        this.transpiler.addCode(`${this.convertVariableType(ctx.variableType.valueType.getText())} ${variables.join(', ')};`);
        this.transpiler.writeLine(ctx.start.line);
    }

    enterForNextStmt(ctx: any) {
        let startCondition = ctx.children[1].getText();
        
        let variable = '';
        variable = startCondition.split('=')[0];
        let stepExp = `${variable}++`;
        let comparisonOperator = '<=';
        if (ctx.step) {
            if (ctx.step[0] == '-') {
                stepExp = `${variable} -= ${ctx.step[0].substr(1)}`;
                comparisonOperator = '>=';
            }
            else {
                stepExp = `${variable} += ${ctx.step[0].substr(1)}`;
            }
        }
        let endCondition = `${variable} ${comparisonOperator} ${ctx.children[3].getText()}`;

        this.transpiler.addCode(`for (${startCondition}; ${endCondition}; ${stepExp}) {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitForNextStmt(ctx: any) {
        this.transpiler.addCode('}');
        this.transpiler.writeLine(ctx.stop.line);
    }

    parseExpression(ctx: any) {
        let exp = '';
        for (let i = 0; i < ctx.children.length; i++) {
            const item = ctx.children[i];
            if (item.symbol) {
                switch (item.symbol.type) {
                    case TibboBasicLexer.EQ:
                        exp += ' == ';
                        break;
                    case TibboBasicLexer.NEQ:
                        exp += ' != ';
                        break;
                    case TibboBasicLexer.AND:
                        exp += ' && ';
                        break;
                    case TibboBasicLexer.OR:
                        exp += ' || ';
                        break;
                    case TibboBasicLexer.XOR:
                        exp += ' ^ ';
                        break;
                    case TibboBasicLexer.SHL:
                        exp += ' << ';
                        break;
                    case TibboBasicLexer.SHR:
                        exp += ' >> ';
                        break;
                    case TibboBasicLexer.NOT:
                        exp += ' ~ ';
                        break;
                    case TibboBasicLexer.MOD:
                        exp += ' % ';
                        break;
                    default:
                        exp += ` ${item.symbol.text} `;
                        break;
                }
            }
            else {
                if (item.ruleIndex == TibboBasicParser.RULE_expression) {
                    exp += this.parseExpression(item);
                }
                else {
                    exp += item.getText();
                }
            }

        }
        return exp;
    }

    enterBlockIfThenElse(ctx: any) {
        let condition = this.parseExpression(ctx.children[1]);
        this.transpiler.addCode(`if (${condition}) {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitBlockIfThenElse(ctx: any) {
        this.transpiler.addCode(`}`)
        this.transpiler.writeLine(ctx.stop.line);
    }

    enterStatement(ctx: any) {
        const code = ctx.getText();
        this.transpiler.addCode(code);
        switch (ctx.children[0].ruleIndex) {
            case TibboBasicParser.RULE_lineLabel:

                break;
            default:
                this.transpiler.addCode(';');
                break;
        }

        this.transpiler.writeLine(ctx.start.line);
    }

    enterWhileWendStmt(ctx: any) {
        let condition = this.parseExpression(ctx.children[1]);
        this.transpiler.addCode(`while (${condition}) {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitWhileWendStmt(ctx: any) {
        this.transpiler.addCode(`}`)
        this.transpiler.writeLine(ctx.stop.line);
    }

    enterExitStmt(ctx: any) {
        switch (ctx.children[0].symbol.type) {
            case TibboBasicLexer.EXIT_DO:
            case TibboBasicLexer.EXIT_FOR:
            case TibboBasicLexer.EXIT_WHILE:
                this.transpiler.addCode('break;');
                this.transpiler.writeLine(ctx.start.line);
                break;
            case TibboBasicLexer.EXIT_SUB:
                this.transpiler.addCode('return;');
                this.transpiler.writeLine(ctx.start.line);
                break;
        }
    }

    enterGoToStmt(ctx: any) {
        this.transpiler.addCode(`goto ${ctx.children[1].getText()};`);
        this.transpiler.writeLine(ctx.start.line);
    }

    enterEnumerationStmt(ctx: any) {
        this.transpiler.addCode(`enum ${ctx.children[1].getText()} {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitEnumerationStmt(ctx: any) {
        this.transpiler.addCode(`};`);
        this.transpiler.writeLine(ctx.stop.line);
    }

    enterSelectCaseStmt(ctx: any) {
        this.transpiler.addCode(`switch (${this.parseExpression(ctx.children[2])}) {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitSelectCaseStmt(ctx: any) {
        this.transpiler.addCode(`}`);
        this.transpiler.writeLine(ctx.stop.line);
    }

    enterConstSubStmt(ctx: any) {
        this.transpiler.addCode(`#define ${ctx.children[0].getText()} ${this.parseExpression(ctx.children[2])}`);
        this.transpiler.writeLine(ctx.start.line);
    }

    enterTypeStmt(ctx: any) {
        this.transpiler.addCode(`struct ${ctx.name.text} {`);
        this.transpiler.writeLine(ctx.start.line);
    }

    exitTypeStmt(ctx: any) {
        this.transpiler.addCode(`};`);
        this.transpiler.writeLine(ctx.stop.line);
    }

    enterTypeStmtElement(ctx: any) {
        let valueType = this.convertVariableType(ctx.valueType.valueType.getText());
        let name = ctx.children[0].getText();
        if (ctx.children.length > 2) {
            name += `(${ctx.children[2]})`;
        }
        this.transpiler.addCode(`${valueType} ${name}`);
        this.transpiler.writeLine(ctx.start.line);
    }

    enterEnumerationStmt_Constant(ctx: any) {
        this.transpiler.addCode(`${ctx.getText()}`);
        this.transpiler.writeLine(ctx.start.line);
    }
}