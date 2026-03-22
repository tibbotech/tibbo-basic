#!/usr/bin/env node
/**
 * Regenerates reference .tpc and .obj files for integration tests.
 *
 * When tmake.exe (the official Tibbo C++ compiler) is available, it is used
 * to generate reference files. Otherwise, the JS compiler generates them
 * so that tests still verify reproducibility across runs.
 *
 * Usage:
 *   node scripts/generate-reference-tpc.js [project-name ...]
 *
 * Options:
 *   --tmake <path>   Path to tmake.exe (default: see below)
 *   --optional       If tmake is missing, fall back to JS compiler instead of failing
 *   --js             Force use of JS compiler even if tmake is available
 *
 * Environment:
 *   TIBBO_TMAKE, TMAKE   Default path to tmake when --tmake is not passed
 *
 * Default tmake path when no env or flag: C:\\Program Files (x86)\\Tibbo\\TIDE\\Bin\\tmake.exe
 *
 * Examples:
 *   node scripts/generate-reference-tpc.js                  # all test projects
 *   node scripts/generate-reference-tpc.js blank             # only the "blank" project
 *   node scripts/generate-reference-tpc.js --js              # force JS compiler
 *   node scripts/generate-reference-tpc.js --tmake D:\TIDE\tmake.exe blank
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.resolve(__dirname, '..', 'tests');
const DEFAULT_TMAKE = String.raw`C:\Program Files (x86)\Tibbo\TIDE\Bin\tmake.exe`;

function parseArgs(argv) {
    const args = argv.slice(2);
    let tmakePath = process.env.TIBBO_TMAKE || process.env.TMAKE || DEFAULT_TMAKE;
    const projects = [];
    let optional = false;
    let forceJs = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tmake' && i + 1 < args.length) {
            tmakePath = args[++i];
        } else if (args[i] === '--optional') {
            optional = true;
        } else if (args[i] === '--js') {
            forceJs = true;
        } else if (!args[i].startsWith('-')) {
            projects.push(args[i]);
        }
    }
    return { tmakePath, projects, optional, forceJs };
}

function discoverProjects(filter) {
    const entries = fs.readdirSync(TESTS_ROOT, { withFileTypes: true });
    const found = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (filter.length > 0 && !filter.includes(entry.name)) continue;

        const dir = path.join(TESTS_ROOT, entry.name);
        const files = fs.readdirSync(dir);
        const tprFile = files.find(f => f.endsWith('.tpr'));
        if (!tprFile) continue;

        const platformsDir = path.join(dir, 'Platforms');
        if (!fs.existsSync(platformsDir)) {
            console.warn(`  SKIP ${entry.name}: no Platforms/ directory`);
            continue;
        }

        found.push({ name: entry.name, dir, tprFile });
    }
    return found;
}

function compileTmake(proj, tmakePath) {
    const platformsDir = path.join(proj.dir, 'Platforms');
    const output = execFileSync(
        tmakePath,
        [proj.tprFile, '-p', platformsDir],
        { cwd: proj.dir, encoding: 'utf-8', timeout: 60000 }
    );
    if (output.trim()) console.log(output.trim());
}

function compileJs(proj) {
    const { ProjectCompiler } = require(path.resolve(__dirname, '..', 'server', 'out', 'compiler', 'project'));
    const { parseProjectFile } = require(path.resolve(__dirname, '..', 'server', 'out', 'compiler', 'project'));

    const compiler = new ProjectCompiler(proj.dir);
    const result = compiler.compile();

    if (result.errors.length > 0) {
        console.warn(`  ${result.errors.length} compilation error(s)`);
        for (const e of result.errors.slice(0, 5)) {
            const loc = e.location ? `${e.location.file}:${e.location.line}` : '?';
            console.warn(`    ${loc}: ${e.message.substring(0, 100)}`);
        }
    }

    if (!result.tpc) {
        throw new Error('JS compiler produced no TPC');
    }

    const config = parseProjectFile(path.join(proj.dir, proj.tprFile));
    const tpcName = config.output || path.basename(proj.tprFile, '.tpr') + '.tpc';
    fs.writeFileSync(path.join(proj.dir, tpcName), result.tpc);

    const tmpDir = path.join(proj.dir, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    for (const [name, buf] of result.objs) {
        fs.writeFileSync(path.join(tmpDir, name), buf);
    }
}

function main() {
    const { tmakePath, projects: filter, optional, forceJs } = parseArgs(process.argv);

    const hasTmake = !forceJs && fs.existsSync(tmakePath);
    const useJs = forceJs || !hasTmake;

    if (!hasTmake && !optional && !forceJs) {
        console.error(`tmake.exe not found at: ${tmakePath}`);
        console.error(`Use --tmake <path>, --optional, or --js to proceed.`);
        process.exit(1);
    }

    const projects = discoverProjects(filter);
    if (projects.length === 0) {
        console.error('No matching test projects found.');
        process.exit(1);
    }

    const compiler = useJs ? 'JS compiler' : `tmake (${tmakePath})`;
    console.log(`Using ${compiler}`);
    console.log(`Found ${projects.length} project(s)\n`);

    let failures = 0;

    for (const proj of projects) {
        console.log(`--- ${proj.name} ---`);
        console.log(`  tpr: ${proj.tprFile}`);

        try {
            if (useJs) {
                compileJs(proj);
            } else {
                compileTmake(proj, tmakePath);
            }
            console.log(`  OK\n`);
        } catch (err) {
            console.error(`  FAILED: ${err.message}`);
            if (err.stdout) console.error(err.stdout);
            if (err.stderr) console.error(err.stderr);
            console.log();
            failures++;
        }
    }

    if (failures > 0) {
        console.error(`${failures} project(s) failed.`);
        process.exit(1);
    }
    console.log('All reference TPCs generated successfully.');
}

main();
