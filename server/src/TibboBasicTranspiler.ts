import fs = require('fs');
// import path = require('path');
// import ini = require('ini');
import TibboBasicErrorListener from './TibboBasicErrorListener';
// import { CommonToken } from 'antlr4/Token';
import { TBObject, TBEnum, TBFunction, TBConst, TBVariable, TBScope, TBSyscall, TBType, TBSyntaxError, TBEvent, TBRange, TBSymbol } from './types';
import { CommonToken } from 'antlr4/Token';
import { TerminalNode } from 'antlr4/tree/Tree';
import { CommonTokenStream } from 'antlr4/CommonTokenStream';

const antlr4 = require('antlr4');
const TibboBasicLexer = require('../language/TibboBasic/lib/TibboBasicLexer').TibboBasicLexer;
const TibboBasicParser = require('../language/TibboBasic/lib/TibboBasicParser').TibboBasicParser;
const TibboBasicParserListener = require('../language/TibboBasic/lib/TibboBasicParserListener').TibboBasicParserListener;

export default class TibboBasicTranspiler {

    output = '';

    parseFile(filePath: string): void {
        const contents = fs.readFileSync(filePath, 'utf-8');

        const chars = new antlr4.InputStream(contents);
        chars.name = filePath;
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

        const newFileName = filePath.substr(0, filePath.length - 4) + '.tbc';
        fs.writeFileSync(newFileName, this.output);

    }

    writeCode(code: string) {
        this.output += code;
    }

}


class ParserListener extends TibboBasicParserListener {

    transpiler: TibboBasicTranspiler;
    currentObject?: string;
    currentProperty?: string;
    scopeStack: Array<TBScope> = [];

    constructor(transpiler: TibboBasicTranspiler) {
        super();
        this.transpiler = transpiler;
    }


    enterIncludeStmt(ctx) {
        this.transpiler.writeCode(`#${ctx.children[0].getText()} ${ctx.children[1].getText()}\r\n`);
    }

    enterSubStmt(ctx) {
        const code = `void ${ctx.children[1].getText()}`
    }
}