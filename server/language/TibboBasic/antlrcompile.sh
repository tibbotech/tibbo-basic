#!/bin/bash


ANTLR4_TOOLS_ANTLR_VERSION=4.8 antlr4 -Dlanguage=JavaScript TibboBasicLexer.g4 -o ./lib
ANTLR4_TOOLS_ANTLR_VERSION=4.8 antlr4 -Dlanguage=JavaScript TibboBasicParser.g4 -o ./lib
ANTLR4_TOOLS_ANTLR_VERSION=4.8 antlr4 -Dlanguage=JavaScript TibboBasicPreprocessorLexer.g4 -o ./lib
ANTLR4_TOOLS_ANTLR_VERSION=4.8 antlr4 -Dlanguage=JavaScript TibboBasicPreprocessorParser.g4 -o ./lib
