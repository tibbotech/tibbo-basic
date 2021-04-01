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


    parseFile(filePath: string): void {
        const output = '';

        
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

}