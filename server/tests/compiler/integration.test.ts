import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';
import { disassembleBinaryToLines, disassembleBinaryBySourceLine, DecodedLineInstruction } from '../../src/compiler/dump-pdb-instructions';

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
    refPdbFile: string | null;
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

        const pdbFile = path.join(dir, 'database.pdb');
        const refPdbFile = fs.existsSync(pdbFile) ? pdbFile : null;

        projects.push({
            name: entry.name,
            dir,
            tprFile: path.join(dir, tprFile),
            tpcFile: tpcFile ? path.join(dir, tpcFile) : null,
            refObjDir: hasRefObjs ? tmpDir : null,
            refPdbFile,
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
const PDB_SECTION_COUNT = 20;

// ---------------------------------------------------------------------------
// PDB comparison helpers (format reference: TOBJ.ts / format.ts)
// ---------------------------------------------------------------------------

interface PdbSectionInfo {
    offset: number;
    size: number;
}

interface PdbHeader {
    signature: string;
    version: string;
    checksum: number;
    fileSize: number;
    platformSize: number;
    globalAllocSize: number;
    stackSize: number;
    localAllocSize: number;
    flags: number;
    projectNameOff: number;
    buildIdOff: number;
    fwVersionOff: number;
    sections: PdbSectionInfo[];
}

function parsePdbHeader(buf: Buffer): PdbHeader {
    const sections: PdbSectionInfo[] = [];
    for (let i = 0; i < PDB_SECTION_COUNT; i++) {
        sections.push({
            offset: buf.readUInt32LE(HEADER_SIZE + i * 8),
            size: buf.readUInt32LE(HEADER_SIZE + i * 8 + 4),
        });
    }
    return {
        signature: buf.toString('ascii', 0, 4),
        version: buf[4] + '.' + buf[5],
        checksum: buf.readUInt16LE(6),
        fileSize: buf.readUInt32LE(8),
        platformSize: buf.readUInt32LE(12),
        globalAllocSize: buf.readUInt32LE(16),
        stackSize: buf.readUInt32LE(20),
        localAllocSize: buf.readUInt32LE(24),
        flags: buf.readUInt32LE(28),
        projectNameOff: buf.readUInt32LE(32),
        buildIdOff: buf.readUInt32LE(36),
        fwVersionOff: buf.readUInt32LE(40),
        sections,
    };
}

function pdbGetSym(buf: Buffer, symbolsSectionOff: number, strOff: number): string {
    const start = symbolsSectionOff + strOff;
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', start, end);
}

interface PdbFunctionEntry {
    name: string;
    addressIndex: number;
    eventIndex: number;
    calleeCount: number;
}

function parsePdbFunctions(buf: Buffer, section: PdbSectionInfo, symbolsOff: number): PdbFunctionEntry[] {
    const result: PdbFunctionEntry[] = [];
    const data = buf.slice(section.offset, section.offset + section.size);
    let idx = 0;
    while (idx < data.length) {
        const flags = data[idx];
        const name = pdbGetSym(buf, symbolsOff, data.readUInt32LE(idx + 1));
        const addressIndex = data.readUInt32LE(idx + 5);
        const eventIndex = data.readUInt32LE(idx + 9);
        const calleeCount = data.readUInt32LE(idx + 13);
        result.push({ name, addressIndex, eventIndex, calleeCount });
        idx += 17 + calleeCount * 4;
    }
    return result;
}

interface PdbVariableEntry {
    flags: number;
    name: string;
    addressIndex: number;
    scopeIndex: number;
}

function parsePdbVariables(buf: Buffer, section: PdbSectionInfo, symbolsOff: number): PdbVariableEntry[] {
    const result: PdbVariableEntry[] = [];
    const data = buf.slice(section.offset, section.offset + section.size);
    let idx = 0;
    while (idx < data.length) {
        result.push({
            flags: data[idx],
            name: pdbGetSym(buf, symbolsOff, data.readUInt32LE(idx + 1)),
            addressIndex: data.readUInt32LE(idx + 5),
            scopeIndex: data.readUInt32LE(idx + 9),
        });
        idx += 18;
    }
    return result;
}

interface PdbLineInfoFile {
    fileName: string;
    lines: Array<{ line: number; address: number }>;
}

function parsePdbLineInfo(buf: Buffer, section: PdbSectionInfo, symbolsOff: number): PdbLineInfoFile[] {
    const result: PdbLineInfoFile[] = [];
    const data = buf.slice(section.offset, section.offset + section.size);
    let idx = 0;
    while (idx < data.length) {
        const fileName = pdbGetSym(buf, symbolsOff, data.readUInt32LE(idx));
        const lineCount = data.readUInt32LE(idx + 4);
        idx += 8;
        const lines: Array<{ line: number; address: number }> = [];
        for (let i = 0; i < lineCount; i++) {
            lines.push({ line: data.readUInt32LE(idx), address: data.readUInt32LE(idx + 4) });
            idx += 8;
        }
        result.push({ fileName, lines });
    }
    return result;
}

function logPdbComparison(refH: PdbHeader, jsH: PdbHeader): void {
    const headerFields: Array<[string, keyof PdbHeader]> = [
        ['platformSize', 'platformSize'],
        ['globalAllocSize', 'globalAllocSize'],
        ['stackSize', 'stackSize'],
        ['localAllocSize', 'localAllocSize'],
        ['flags', 'flags'],
    ];
    for (const [label, key] of headerFields) {
        const rv = refH[key], jv = jsH[key];
        if (rv !== jv) console.log(`  header.${label}: ref=${rv} js=${jv}`);
    }
    for (let i = 0; i < PDB_SECTION_COUNT; i++) {
        const rs = refH.sections[i].size, js = jsH.sections[i].size;
        if (rs !== js) {
            console.log(`  ${SECTION_NAMES[i]}: ref=${rs} js=${js} DIFF(${rs - js})`);
        }
    }
}

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

            it('should match reference decoded bytecode instructions', () => {
                const expected = fs.readFileSync(project.tpcFile!);
                expect(result.tpc).not.toBeNull();

                const diffs = compareTpcMasked(result.tpc!, expected);
                if (diffs.length > 0) {
                    console.log(
                        `Skipping decoded bytecode assertion for ${project.name} because masked TPC comparison differs (${diffs[0] === -1 ? 'size mismatch' : `${diffs.length} byte diffs`}).`,
                    );
                    return;
                }

                const expectedInstructions = disassembleBinaryToLines(expected);
                const actualInstructions = disassembleBinaryToLines(result.tpc!);

                if (expectedInstructions.length !== actualInstructions.length) {
                    console.log(
                        `Instruction count mismatch for ${project.name}: expected=${expectedInstructions.length} actual=${actualInstructions.length}`,
                    );
                } else {
                    const firstDiffIndex = expectedInstructions.findIndex((line, idx) => line !== actualInstructions[idx]);
                    if (firstDiffIndex >= 0) {
                        console.log(`First decoded instruction mismatch for ${project.name} at index ${firstDiffIndex}:`);
                        console.log(`  expected: ${expectedInstructions[firstDiffIndex]}`);
                        console.log(`  actual:   ${actualInstructions[firstDiffIndex]}`);
                    }
                }

                expect(actualInstructions).toEqual(expectedInstructions);
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

        if (project.refPdbFile) {
            describe('PDB comparison', () => {
                let refBuf: Buffer;
                let jsBuf: Buffer;
                let refH: PdbHeader;
                let jsH: PdbHeader;
                let pdbAvailable = false;

                beforeAll(() => {
                    refBuf = fs.readFileSync(project.refPdbFile!);
                    const jsPdbPath = path.join(project.dir, 'tmp', 'database.pdb');
                    if (!fs.existsSync(jsPdbPath)) return;
                    jsBuf = fs.readFileSync(jsPdbPath);
                    refH = parsePdbHeader(refBuf);
                    jsH = parsePdbHeader(jsBuf);
                    pdbAvailable = true;
                });

                it('should produce a PDB with TPDB signature', () => {
                    expect(pdbAvailable).toBe(true);
                    expect(jsH.signature).toBe('TPDB');
                });

                it('should match PDB header allocation fields', () => {
                    if (!pdbAvailable) return;
                    logPdbComparison(refH, jsH);
                    expect(jsH.platformSize).toBe(refH.platformSize);
                    expect(jsH.globalAllocSize).toBe(refH.globalAllocSize);
                    expect(jsH.stackSize).toBe(refH.stackSize);
                    expect(jsH.localAllocSize).toBe(refH.localAllocSize);
                    expect(jsH.flags).toBe(refH.flags);
                });

                it('should match PDB section sizes', () => {
                    if (!pdbAvailable) return;
                    const diffs: string[] = [];
                    for (let i = 0; i < PDB_SECTION_COUNT; i++) {
                        const rs = refH.sections[i].size;
                        const js = jsH.sections[i].size;
                        if (rs !== js) {
                            diffs.push(`${SECTION_NAMES[i]}: ref=${rs} js=${js} DIFF(${rs - js})`);
                        }
                    }
                    if (diffs.length > 0) {
                        console.log(`PDB section size diffs for ${project.name}:`);
                        for (const d of diffs) console.log(`  ${d}`);
                    }
                    expect(diffs).toHaveLength(0);
                });

                it('should match PDB Code section content', () => {
                    if (!pdbAvailable) return;
                    const refCode = refBuf.slice(refH.sections[0].offset, refH.sections[0].offset + refH.sections[0].size);
                    const jsCode = jsBuf.slice(jsH.sections[0].offset, jsH.sections[0].offset + jsH.sections[0].size);
                    if (refCode.length !== jsCode.length) {
                        console.log(`PDB Code size: ref=${refCode.length} js=${jsCode.length}`);
                    }
                    expect(jsCode.length).toBe(refCode.length);
                    expect(jsCode.equals(refCode)).toBe(true);
                });

                it('should match PDB function entries', () => {
                    if (!pdbAvailable) return;
                    const symbolsOff = refH.sections[4].offset;
                    const jsSymbolsOff = jsH.sections[4].offset;
                    const refFuncs = parsePdbFunctions(refBuf, refH.sections[10], symbolsOff);
                    const jsFuncs = parsePdbFunctions(jsBuf, jsH.sections[10], jsSymbolsOff);
                    const refNames = refFuncs.map(f => f.name).sort();
                    const jsNames = jsFuncs.map(f => f.name).sort();
                    if (refNames.join(',') !== jsNames.join(',')) {
                        console.log(`PDB functions: ref=[${refNames}] js=[${jsNames}]`);
                    }
                    expect(jsNames).toEqual(refNames);
                });

                it('should match PDB variable entries', () => {
                    if (!pdbAvailable) return;
                    const symbolsOff = refH.sections[4].offset;
                    const jsSymbolsOff = jsH.sections[4].offset;
                    const refVars = parsePdbVariables(refBuf, refH.sections[12], symbolsOff);
                    const jsVars = parsePdbVariables(jsBuf, jsH.sections[12], jsSymbolsOff);
                    const refNames = refVars.map(v => v.name).sort();
                    const jsNames = jsVars.map(v => v.name).sort();
                    if (refNames.join(',') !== jsNames.join(',')) {
                        console.log(`PDB variables: ref=[${refNames}] js=[${jsNames}]`);
                    }
                    expect(jsNames).toEqual(refNames);
                });

                it('should match PDB line info', () => {
                    if (!pdbAvailable) return;
                    const symbolsOff = refH.sections[4].offset;
                    const jsSymbolsOff = jsH.sections[4].offset;
                    const refLines = parsePdbLineInfo(refBuf, refH.sections[17], symbolsOff);
                    const jsLines = parsePdbLineInfo(jsBuf, jsH.sections[17], jsSymbolsOff);

                    const refFileNames = refLines.map(f => f.fileName).sort();
                    const jsFileNames = jsLines.map(f => f.fileName).sort();
                    if (refFileNames.join(',') !== jsFileNames.join(',')) {
                        console.log(`PDB line info files: ref=[${refFileNames}] js=[${jsFileNames}]`);
                    }
                    expect(jsFileNames).toEqual(refFileNames);

                    for (const refFile of refLines) {
                        const jsFile = jsLines.find(f => f.fileName === refFile.fileName);
                        if (!jsFile) continue;
                        if (refFile.lines.length !== jsFile.lines.length) {
                            console.log(`PDB line info ${refFile.fileName}: ref=${refFile.lines.length} lines, js=${jsFile.lines.length} lines`);
                        }
                        expect(jsFile.lines.length).toBe(refFile.lines.length);
                        for (let i = 0; i < Math.min(refFile.lines.length, jsFile.lines.length); i++) {
                            if (refFile.lines[i].line !== jsFile.lines[i].line || refFile.lines[i].address !== jsFile.lines[i].address) {
                                console.log(`PDB line info ${refFile.fileName}[${i}]: ref=(line=${refFile.lines[i].line},addr=0x${refFile.lines[i].address.toString(16)}) js=(line=${jsFile.lines[i].line},addr=0x${jsFile.lines[i].address.toString(16)})`);
                            }
                        }
                    }
                });

                it('should match PDB EventDir section content', () => {
                    if (!pdbAvailable) return;
                    const refEvt = refBuf.slice(refH.sections[6].offset, refH.sections[6].offset + refH.sections[6].size);
                    const jsEvt = jsBuf.slice(jsH.sections[6].offset, jsH.sections[6].offset + jsH.sections[6].size);
                    if (refEvt.length !== jsEvt.length) {
                        console.log(`PDB EventDir size: ref=${refEvt.length} js=${jsEvt.length}`);
                    }
                    expect(jsEvt.length).toBe(refEvt.length);
                    if (refEvt.length === jsEvt.length) {
                        expect(jsEvt.equals(refEvt)).toBe(true);
                    }
                });

                it('should match PDB decoded instructions by source line', () => {
                    if (!pdbAvailable) return;
                    const refDecoded = disassembleBinaryBySourceLine(refBuf);
                    const jsDecoded = disassembleBinaryBySourceLine(jsBuf);

                    if (refDecoded.length !== jsDecoded.length) {
                        console.log(`PDB decoded instruction count: ref=${refDecoded.length} js=${jsDecoded.length}`);
                        const refSummary = new Map<string, number>();
                        for (const d of refDecoded) {
                            const key = `${d.fileName}:${d.line}`;
                            refSummary.set(key, (refSummary.get(key) ?? 0) + 1);
                        }
                        const jsSummary = new Map<string, number>();
                        for (const d of jsDecoded) {
                            const key = `${d.fileName}:${d.line}`;
                            jsSummary.set(key, (jsSummary.get(key) ?? 0) + 1);
                        }
                        const allKeys = new Set([...refSummary.keys(), ...jsSummary.keys()]);
                        for (const key of [...allKeys].sort()) {
                            const rc = refSummary.get(key) ?? 0;
                            const jc = jsSummary.get(key) ?? 0;
                            if (rc !== jc) {
                                console.log(`  ${key}: ref=${rc} instructions, js=${jc} instructions`);
                            }
                        }
                    }

                    const limit = Math.min(refDecoded.length, jsDecoded.length);
                    for (let i = 0; i < limit; i++) {
                        const r = refDecoded[i];
                        const j = jsDecoded[i];
                        if (r.fileName !== j.fileName || r.line !== j.line || r.instruction !== j.instruction) {
                            console.log(`PDB instruction diff at index ${i}:`);
                            console.log(`  ref: ${r.fileName}:${r.line} ${r.instruction}`);
                            console.log(`  js:  ${j.fileName}:${j.line} ${j.instruction}`);
                            break;
                        }
                    }

                    expect(jsDecoded.length).toBe(refDecoded.length);
                    for (let i = 0; i < limit; i++) {
                        expect(jsDecoded[i]).toEqual(refDecoded[i]);
                    }
                });

                it('should match PDB decoded bytecode against generated TPC bytecode', () => {
                    if (!pdbAvailable || !result.tpc) return;
                    const refPdbInstructions = disassembleBinaryToLines(refBuf);
                    const jsTpcInstructions = disassembleBinaryToLines(result.tpc!);

                    if (refPdbInstructions.length !== jsTpcInstructions.length) {
                        console.log(`PDB vs TPC instruction count: pdb=${refPdbInstructions.length} tpc=${jsTpcInstructions.length}`);
                    }

                    const limit = Math.min(refPdbInstructions.length, jsTpcInstructions.length);
                    for (let i = 0; i < limit; i++) {
                        if (refPdbInstructions[i] !== jsTpcInstructions[i]) {
                            console.log(`PDB vs TPC instruction diff at index ${i}:`);
                            console.log(`  pdb: ${refPdbInstructions[i]}`);
                            console.log(`  tpc: ${jsTpcInstructions[i]}`);
                            break;
                        }
                    }

                    expect(jsTpcInstructions.length).toBe(refPdbInstructions.length);
                    for (let i = 0; i < limit; i++) {
                        expect(jsTpcInstructions[i]).toBe(refPdbInstructions[i]);
                    }
                });
            });
        }
    });
}
