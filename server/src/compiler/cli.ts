#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { compile, link, CompileOptions } from './index';

interface CLIArgs {
    inputFiles: string[];
    outputFile?: string;
    defines: Record<string, string>;
    includePaths: string[];
    doLink: boolean;
    verbose: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
    const args: CLIArgs = {
        inputFiles: [],
        defines: {},
        includePaths: [],
        doLink: false,
        verbose: false,
    };

    let i = 2; // skip node and script
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '-o' && i + 1 < argv.length) {
            args.outputFile = argv[++i];
        } else if (arg === '-d' && i + 1 < argv.length) {
            const def = argv[++i];
            const eqIdx = def.indexOf('=');
            if (eqIdx > 0) {
                args.defines[def.substring(0, eqIdx)] = def.substring(eqIdx + 1);
            } else {
                args.defines[def] = '1';
            }
        } else if (arg === '-i' && i + 1 < argv.length) {
            args.includePaths.push(argv[++i]);
        } else if (arg === '-l' || arg === '--link') {
            args.doLink = true;
        } else if (arg === '-v' || arg === '--verbose') {
            args.verbose = true;
        } else if (arg === '-h' || arg === '--help') {
            printUsage();
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            args.inputFiles.push(arg);
        }
        i++;
    }

    return args;
}

function printUsage(): void {
    console.log(`Usage: tbc [options] <input.tbs ...>

Options:
  -o <file>      Output file (.obj or .tpc)
  -d <NAME[=VAL]> Define preprocessor symbol
  -i <dir>       Add include search path
  -l, --link     Link .obj files into .tpc
  -v, --verbose  Verbose output
  -h, --help     Show this help

Examples:
  tbc main.tbs -o main.obj
  tbc -l main.obj lib.obj -o output.tpc
  tbc main.tbs -d PLATFORM=EM2000 -o main.obj`);
}

function main(): void {
    const args = parseArgs(process.argv);

    if (args.inputFiles.length === 0) {
        console.error('Error: No input files specified');
        printUsage();
        process.exit(1);
    }

    if (args.doLink) {
        linkMode(args);
    } else {
        compileMode(args);
    }
}

function compileMode(args: CLIArgs): void {
    let hasErrors = false;

    for (const inputFile of args.inputFiles) {
        let source: string;
        try {
            source = fs.readFileSync(inputFile, 'utf-8');
        } catch (e) {
            console.error(`error: Cannot read file "${inputFile}": ${e instanceof Error ? e.message : String(e)}`);
            hasErrors = true;
            continue;
        }

        const ext = path.extname(inputFile);
        const baseName = path.basename(inputFile, ext);
        const outputFile = args.outputFile ?? `${baseName}.obj`;

        const options: CompileOptions = {
            fileName: inputFile,
            defines: args.defines,
            includePaths: args.includePaths,
        };

        if (args.verbose) {
            console.log(`Compiling ${inputFile}...`);
        }

        const result = compile(source, options);

        for (const err of result.errors) {
            console.error(`${err.location.file}:${err.location.line}:${err.location.column}: error: ${err.message}`);
            hasErrors = true;
        }

        for (const warn of result.warnings) {
            console.warn(`${warn.location.file}:${warn.location.line}:${warn.location.column}: warning: ${warn.message}`);
        }

        if (!hasErrors) {
            fs.writeFileSync(outputFile, result.obj);
            if (args.verbose) {
                console.log(`  -> ${outputFile} (${result.obj.length} bytes)`);
            }
        }
    }

    process.exit(hasErrors ? 1 : 0);
}

function linkMode(args: CLIArgs): void {
    const objFiles: { name: string; data: Buffer }[] = [];
    for (const f of args.inputFiles) {
        try {
            objFiles.push({ name: f, data: fs.readFileSync(f) });
        } catch (e) {
            console.error(`error: Cannot read file "${f}": ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
        }
    }

    const outputFile = args.outputFile ?? 'output.tpc';

    if (args.verbose) {
        console.log(`Linking ${args.inputFiles.join(', ')}...`);
    }

    const result = link(objFiles);

    let hasErrors = false;
    for (const err of result.errors) {
        console.error(`${err.location.file}:${err.location.line}:${err.location.column}: error: ${err.message}`);
        hasErrors = true;
    }

    for (const warn of result.warnings) {
        console.warn(`${warn.location.file}:${warn.location.line}:${warn.location.column}: warning: ${warn.message}`);
    }

    if (!hasErrors) {
        fs.writeFileSync(outputFile, result.tpc);
        if (args.verbose) {
            console.log(`  -> ${outputFile} (${result.tpc.length} bytes)`);
        }

        const pdbFile = outputFile.replace(/\.[^.]+$/, '.pdb');
        fs.writeFileSync(pdbFile, result.pdb);
        if (args.verbose) {
            console.log(`  -> ${pdbFile} (${result.pdb.length} bytes)`);
        }
    }

    process.exit(hasErrors ? 1 : 0);
}

main();
