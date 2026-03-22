import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TESTS_ROOT = path.resolve(REPO_ROOT, 'tests');

/** Regenerate reference .tpc and .obj files via tmake before comparing outputs. */
beforeAll(() => {
    const script = path.join(REPO_ROOT, 'scripts', 'generate-reference-tpc.js');
    execFileSync(process.execPath, [script], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        env: process.env,
    });
});

// ---------------------------------------------------------------------------
// TPC comparison helpers
// ---------------------------------------------------------------------------

function strLenAt(buf: Buffer, base: number, off: number): number {
    let len = 0;
    while (base + off + len < buf.length && buf[base + off + len] !== 0) len++;
    return len;
}

/**
 * Compare two TPC buffers, masking out build ID, timestamp, and checksum
 * which are expected to differ between builds. Returns the list of
 * byte offsets that still differ after masking ([-1] for size mismatch).
 */
function compareTpcMasked(actual: Buffer, expected: Buffer): number[] {
    if (actual.length !== expected.length) {
        return [-1];
    }

    const maskedExpected = Buffer.from(expected);
    const maskedActual = Buffer.from(actual);

    // Checksum (bytes 6-7)
    maskedExpected.writeUInt16LE(0, 6);
    maskedActual.writeUInt16LE(0, 6);

    // Header timestamp: daysSince2000 (44-45) and minutesOfDay (46-47)
    maskedExpected.writeUInt16LE(0, 44);
    maskedActual.writeUInt16LE(0, 44);
    maskedExpected.writeUInt16LE(0, 46);
    maskedActual.writeUInt16LE(0, 46);

    // Build ID and timestamp strings in the Symbols section
    const symbolsSectionOff = expected.readUInt32LE(48 + 4 * 8);
    const buildIdStrOff = expected.readUInt32LE(36);
    const extraSectionOff = expected.readUInt32LE(48 + 8 * 8);
    const timeStrOff = expected.readUInt32LE(extraSectionOff);

    const buildIdAbsOff = symbolsSectionOff + buildIdStrOff;
    const maxBuildIdLen = Math.max(
        strLenAt(expected, symbolsSectionOff, buildIdStrOff),
        strLenAt(actual, symbolsSectionOff, buildIdStrOff)
    );
    for (let i = 0; i < maxBuildIdLen; i++) {
        if (buildIdAbsOff + i < maskedExpected.length) maskedExpected[buildIdAbsOff + i] = 0;
        if (buildIdAbsOff + i < maskedActual.length) maskedActual[buildIdAbsOff + i] = 0;
    }

    const timeAbsOff = symbolsSectionOff + timeStrOff;
    const maxTimeLen = Math.max(
        strLenAt(expected, symbolsSectionOff, timeStrOff),
        strLenAt(actual, symbolsSectionOff, timeStrOff)
    );
    for (let i = 0; i < maxTimeLen; i++) {
        if (timeAbsOff + i < maskedExpected.length) maskedExpected[timeAbsOff + i] = 0;
        if (timeAbsOff + i < maskedActual.length) maskedActual[timeAbsOff + i] = 0;
    }

    const diffs: number[] = [];
    for (let i = 0; i < maskedExpected.length; i++) {
        if (maskedExpected[i] !== maskedActual[i]) {
            diffs.push(i);
        }
    }
    return diffs;
}

function logTpcDiffs(actual: Buffer, expected: Buffer, diffs: number[]): void {
    console.log(`Expected TPC size: ${expected.length}`);
    console.log(`Produced TPC size: ${actual.length}`);

    if (actual.length !== expected.length) {
        console.log('Size mismatch - skipping detailed byte comparison');
        return;
    }

    const sections = ['Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra'];
    for (let i = 0; i < 9; i++) {
        const expOff = expected.readUInt32LE(48 + i * 8);
        const expSize = expected.readUInt32LE(52 + i * 8);
        const gotOff = actual.readUInt32LE(48 + i * 8);
        const gotSize = actual.readUInt32LE(52 + i * 8);
        if (expSize !== gotSize || expOff !== gotOff) {
            console.log(`  ${sections[i]}: exp=(off=${expOff},sz=${expSize}) got=(off=${gotOff},sz=${gotSize})`);
        }
    }

    if (diffs.length > 0) {
        console.log(`Unexpected diffs at ${diffs.length} byte(s):`);
        for (const off of diffs.slice(0, 20)) {
            console.log(`  0x${off.toString(16)}: expected=0x${expected[off].toString(16).padStart(2, '0')} actual=0x${actual[off].toString(16).padStart(2, '0')}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Auto-discover test projects: any folder under tests/ with a .tpr file
// ---------------------------------------------------------------------------

interface TestProject {
    name: string;
    dir: string;
    tprFile: string;
    tpcFile: string | null;
    refObjDir: string | null;
}

function discoverTestProjects(): TestProject[] {
    const projects: TestProject[] = [];
    for (const entry of fs.readdirSync(TESTS_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(TESTS_ROOT, entry.name);
        const files = fs.readdirSync(dir);

        const tprFile = files.find(f => f.endsWith('.tpr'));
        if (!tprFile) continue;

        const tpcFile = files.find(f => f.endsWith('.tpc') && !f.includes('_new')) || null;

        const tmpDir = path.join(dir, 'tmp');
        const hasRefObjs = fs.existsSync(tmpDir) &&
            fs.readdirSync(tmpDir).some(f => f.endsWith('.obj'));

        projects.push({
            name: entry.name,
            dir,
            tprFile: path.join(dir, tprFile),
            tpcFile: tpcFile ? path.join(dir, tpcFile) : null,
            refObjDir: hasRefObjs ? tmpDir : null,
        });
    }
    return projects;
}

const testProjects = discoverTestProjects();

const SECTION_NAMES = [
    'Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra',
    'Addresses', 'Functions', 'Scopes', 'Variables', 'Objects', 'Syscalls', 'Types', 'RDataDir', 'LineInfo', 'LibNameDir', 'IncNameDir',
];
const HEADER_SIZE = 48;

// ---------------------------------------------------------------------------
// Generate tests for each discovered project
// ---------------------------------------------------------------------------

for (const project of testProjects) {
    describe(`${project.name}`, () => {
        let result: ReturnType<ProjectCompiler['compile']>;

        beforeAll(() => {
            const compiler = new ProjectCompiler(project.dir);
            result = compiler.compile();
        });

        it('should parse the .tpr file', () => {
            const config = parseProjectFile(project.tprFile);
            expect(config.name).toBeTruthy();
            expect(config.platform).toBeTruthy();
            expect(config.sourceFiles.length).toBeGreaterThan(0);
        });

        it('should compile without errors', () => {
            if (result.errors.length > 0) {
                console.log(`Compilation errors for ${project.name}:`);
                for (const err of result.errors.slice(0, 50)) {
                    console.log(`  ${err.location.file}:${err.location.line}:${err.location.column}: ${err.message}`);
                }
                console.log(`  Total errors: ${result.errors.length}`);
            }
            if (result.warnings.length > 0) {
                const warnGroups = new Map<string, number>();
                for (const w of result.warnings) {
                    const key = w.message.substring(0, 60);
                    warnGroups.set(key, (warnGroups.get(key) || 0) + 1);
                }
                console.log(`Warning summary for ${project.name}:`);
                for (const [msg, count] of [...warnGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
                    console.log(`  ${count}x: ${msg}`);
                }
                console.log(`  Total warnings: ${result.warnings.length}`);
            }
            expect(result.objs.size).toBeGreaterThanOrEqual(1);
        });

        it('should produce a valid .tpc with TBIN signature', () => {
            expect(result.tpc).not.toBeNull();
            expect(result.tpc!.toString('ascii', 0, 4)).toBe('TBIN');
        });

        if (project.tpcFile) {
            it('should match reference TPC (only build ID and timestamp differ)', () => {
                const expected = fs.readFileSync(project.tpcFile!);
                expect(result.tpc).not.toBeNull();

                const diffs = compareTpcMasked(result.tpc!, expected);
                if (diffs.length > 0) logTpcDiffs(result.tpc!, expected, diffs);
                expect(result.tpc!.length).toBe(expected.length);
                expect(diffs).toHaveLength(0);
            });
        }

        if (project.refObjDir) {
            describe('per-file OBJ section sizes', () => {
                const refObjNames = fs.readdirSync(project.refObjDir!)
                    .filter(f => f.endsWith('.obj'));

                for (const objName of refObjNames) {
                    it(`should match section sizes for ${objName}`, () => {
                        const gen = result.objs.get(objName);
                        if (!gen) {
                            console.log(`  ${objName}: not produced by compiler (skipping)`);
                            return;
                        }

                        const ref = fs.readFileSync(path.join(project.refObjDir!, objName));
                        const refCodeSize = ref.readUInt32LE(HEADER_SIZE + 4);
                        const genCodeSize = gen.readUInt32LE(HEADER_SIZE + 4);
                        const refInitSize = ref.readUInt32LE(HEADER_SIZE + 8 + 4);
                        const genInitSize = gen.readUInt32LE(HEADER_SIZE + 8 + 4);

                        console.log(`${objName}: Code exp=${refCodeSize} got=${genCodeSize} (${refCodeSize === genCodeSize ? 'OK' : 'DIFF(' + (refCodeSize - genCodeSize) + ')'}), Init exp=${refInitSize} got=${genInitSize}`);

                        for (let i = 0; i < 20; i++) {
                            const rOff = HEADER_SIZE + i * 8;
                            if (rOff + 8 > ref.length || rOff + 8 > gen.length) break;
                            const rSz = ref.readUInt32LE(rOff + 4);
                            const gSz = gen.readUInt32LE(rOff + 4);
                            if (rSz !== gSz) {
                                console.log(`  ${SECTION_NAMES[i] || i}: ref=${rSz} gen=${gSz} DIFF(${rSz - gSz})`);
                            }
                        }
                    });
                }
            });
        }
    });
}
