#!/usr/bin/env node
/**
 * Regenerates reference .tpc and .obj files for integration tests by running
 * the official Tibbo tmake compiler on each test project.
 *
 * Usage:
 *   node scripts/generate-reference-tpc.js [project-name ...]
 *
 * Options:
 *   --tmake <path>   Path to tmake.exe (default: C:\Program Files (x86)\Tibbo\TIDE\Bin\tmake.exe)
 *
 * Examples:
 *   node scripts/generate-reference-tpc.js                  # all test projects
 *   node scripts/generate-reference-tpc.js blank             # only the "blank" project
 *   node scripts/generate-reference-tpc.js --tmake D:\TIDE\tmake.exe blank
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.resolve(__dirname, '..', 'tests');
const DEFAULT_TMAKE = String.raw`C:\Program Files (x86)\Tibbo\TIDE\Bin\tmake.exe`;

function parseArgs(argv) {
    const args = argv.slice(2);
    let tmakePath = DEFAULT_TMAKE;
    const projects = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tmake' && i + 1 < args.length) {
            tmakePath = args[++i];
        } else if (!args[i].startsWith('-')) {
            projects.push(args[i]);
        }
    }
    return { tmakePath, projects };
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

function main() {
    const { tmakePath, projects: filter } = parseArgs(process.argv);

    if (!fs.existsSync(tmakePath)) {
        console.error(`tmake.exe not found at: ${tmakePath}`);
        console.error(`Use --tmake <path> to specify the correct location.`);
        process.exit(1);
    }

    const projects = discoverProjects(filter);
    if (projects.length === 0) {
        console.error('No matching test projects found.');
        process.exit(1);
    }

    console.log(`Using tmake: ${tmakePath}`);
    console.log(`Found ${projects.length} project(s)\n`);

    let failures = 0;

    for (const proj of projects) {
        const platformsDir = path.join(proj.dir, 'Platforms');
        console.log(`--- ${proj.name} ---`);
        console.log(`  tpr:       ${proj.tprFile}`);
        console.log(`  platforms: ${platformsDir}`);

        try {
            const output = execFileSync(
                tmakePath,
                [proj.tprFile, '-p', platformsDir],
                { cwd: proj.dir, encoding: 'utf-8', timeout: 60000 }
            );
            if (output.trim()) console.log(output.trim());
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
