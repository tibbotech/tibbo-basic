#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { ProjectCompiler, parseProjectFile, ProjectCompilerOptions } from './project';

function printUsage(): void {
    console.log(`Usage: compile-project <project-folder> [options]

Compiles a Tibbo Basic project folder (containing a .tpr file) into a .tpc binary.

Options:
  -o <file>         Output .tpc file (default: <project-name>.tpc in the project folder)
  -p <path>         Platforms folder path (default: <project-folder>/Platforms)
  -v, --verbose     Verbose output
  -h, --help        Show this help

Examples:
  compile-project tests/blank
  compile-project tests/blank -o output.tpc
  compile-project tests/blank -p /path/to/Platforms -v`);
}

function main(): void {
    const argv = process.argv.slice(2);

    let projectFolder: string | undefined;
    let outputFile: string | undefined;
    let platformsPath: string | undefined;
    let verbose = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-o' && i + 1 < argv.length) {
            outputFile = argv[++i];
        } else if (arg === '-p' && i + 1 < argv.length) {
            platformsPath = argv[++i];
        } else if (arg === '-v' || arg === '--verbose') {
            verbose = true;
        } else if (arg === '-h' || arg === '--help') {
            printUsage();
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            projectFolder = arg;
        }
    }
    platformsPath = path.join(__dirname, '..', '..', '..', 'platforms', 'Platforms');
    if (!projectFolder) {
        console.error('Error: No project folder specified');
        printUsage();
        process.exit(1);
    }

    const resolvedPath = path.resolve(projectFolder);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        console.error(`Error: "${resolvedPath}" is not a directory`);
        process.exit(1);
    }

    if (verbose) {
        console.log(`Project folder: ${resolvedPath}`);
    }

    let config;
    try {
        config = parseProjectFile(findTprFile(resolvedPath));
    } catch (e) {
        console.error(`error: Failed to parse project file: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }

    const defaultOutput = path.join(resolvedPath, config.output || `${config.name || 'output'}.tpc`);
    const tpcOutput = outputFile ? path.resolve(outputFile) : defaultOutput;

    if (verbose) {
        console.log(`Project: ${config.name}`);
        console.log(`Platform: ${config.platform}`);
        console.log(`Output: ${tpcOutput}`);
        console.log(`Source files: ${config.sourceFiles.map(f => f.path).join(', ')}`);
        console.log('');
    }

    let compiler;
    try {
        const options: ProjectCompilerOptions = {};
        compiler = new ProjectCompiler(resolvedPath, platformsPath, options);
    } catch (e) {
        console.error(`error: Failed to initialize compiler: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }

    if (verbose) {
        console.log('Compiling...');
    }

    const result = compiler.compile();

    for (const err of result.errors) {
        console.error(`${err.location.file}:${err.location.line}:${err.location.column}: error: ${err.message}`);
    }

    for (const warn of result.warnings) {
        console.warn(`${warn.location.file}:${warn.location.line}:${warn.location.column}: warning: ${warn.message}`);
    }

    if (verbose) {
        console.log(`OBJ files: ${result.objs.size}`);
        for (const [name, buf] of result.objs) {
            console.log(`  ${name}: ${buf.length} bytes`);
        }
    }

    if (result.errors.length > 0) {
        console.error(`\nCompilation failed with ${result.errors.length} error(s)`);
        process.exit(1);
    }

    if (!result.tpc) {
        console.error('Compilation produced no output');
        process.exit(1);
    }

    fs.writeFileSync(tpcOutput, result.tpc);
    console.log(`${tpcOutput} (${result.tpc.length} bytes)`);

    if (result.pdb) {
        const pdbOutput = tpcOutput.replace(/\.[^.]+$/, '.pdb');
        fs.writeFileSync(pdbOutput, result.pdb);
        if (verbose) {
            console.log(`${pdbOutput} (${result.pdb.length} bytes)`);
        }
    }

    if (verbose) {
        const sig = result.tpc.toString('ascii', 0, 4);
        const fileSize = result.tpc.readUInt32LE(8);
        const flags = result.tpc.readUInt32LE(28);
        console.log(`  Signature: ${sig}`);
        console.log(`  File size: ${fileSize}`);
        console.log(`  Flags: 0x${flags.toString(16).padStart(2, '0')}`);

        const sectionNames = ['Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra'];
        for (let i = 0; i < 9; i++) {
            const off = result.tpc.readUInt32LE(48 + i * 8);
            const sz = result.tpc.readUInt32LE(52 + i * 8);
            if (sz > 0) {
                console.log(`  ${sectionNames[i]}: offset=${off}, size=${sz}`);
            }
        }
    }
}

function findTprFile(dir: string): string {
    const files = fs.readdirSync(dir);
    const tpr = files.find(f => path.extname(f) === '.tpr');
    if (!tpr) throw new Error(`No .tpr project file found in ${dir}`);
    return path.join(dir, tpr);
}

main();
