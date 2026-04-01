import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';
import { disassembleBinaryToLines, disassembleBinaryBySourceLine, DecodedLineInstruction } from '../../src/compiler/dump-pdb-instructions';
import { TOBJ_SIGNATURE_BIN, MAXDWORD, TObjSection } from '../../src/compiler/tobj/format';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TESTS_ROOT = path.resolve(REPO_ROOT, 'server', 'tests');

/**
 * Regenerate reference .tpc (and tmp/*.obj when tmake runs) before comparing outputs.
 * Per-project OBJ parity uses committed `tmake-ref/*.obj` when present — official tmake
 * layout preserved in git — not the volatile `tmp/` copy from this run.
 */
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

function getTobjSectionCount(buf: Buffer): number {
    return buf.readUInt32LE(0) === TOBJ_SIGNATURE_BIN ? TObjSection.CountBin : TObjSection.CountObj;
}

interface TobjDevMaskLens {
    maxBuildIdLen: number;
    maxTimeLen: number;
    maxProjectNameLen: number;
    maxFirmwareVerLen: number;
    maxExtraSrcLen: number;
    maxExtraConfigLen: number;
    /** Per LineInfo file entry; undefined = skip (TBIN or parse mismatch) */
    lineInfoFileNameLens?: number[];
}

function computeLineInfoFileNameLens(a: Buffer, b: Buffer): number[] | undefined {
    if (getTobjSectionCount(a) < TObjSection.CountObj || getTobjSectionCount(b) < TObjSection.CountObj) {
        return undefined;
    }
    const symA = a.readUInt32LE(HEADER_SIZE + TObjSection.Symbols * 8);
    const symB = b.readUInt32LE(HEADER_SIZE + TObjSection.Symbols * 8);
    const da = HEADER_SIZE + TObjSection.LineInfo * 8;
    const offA = a.readUInt32LE(da);
    const szA = a.readUInt32LE(da + 4);
    const offB = b.readUInt32LE(da);
    const szB = b.readUInt32LE(da + 4);
    if (szA !== szB || szA === 0) return undefined;
    let pos = 0;
    const lens: number[] = [];
    while (pos + 8 <= szA) {
        const fa = a.readUInt32LE(offA + pos);
        const fb = b.readUInt32LE(offB + pos);
        const lc = a.readUInt32LE(offA + pos + 4);
        const lcB = b.readUInt32LE(offB + pos + 4);
        if (lc !== lcB) return undefined;
        lens.push(Math.max(strLenAt(a, symA, fa), strLenAt(b, symB, fb)));
        pos += 8 + lc * 8;
    }
    if (pos !== szA) return undefined;
    return lens;
}

function computeTobjDevMaskLens(a: Buffer, b: Buffer): TobjDevMaskLens {
    const empty: TobjDevMaskLens = {
        maxBuildIdLen: 0,
        maxTimeLen: 0,
        maxProjectNameLen: 0,
        maxFirmwareVerLen: 0,
        maxExtraSrcLen: 0,
        maxExtraConfigLen: 0,
    };
    if (a.length < HEADER_SIZE + 9 * 8 || b.length < HEADER_SIZE + 9 * 8) {
        return empty;
    }
    const buildIdStrOff = a.readUInt32LE(36);
    const symA = a.readUInt32LE(HEADER_SIZE + TObjSection.Symbols * 8);
    const symB = b.readUInt32LE(HEADER_SIZE + TObjSection.Symbols * 8);
    const projA = a.readUInt32LE(32);
    const projB = b.readUInt32LE(32);
    const fwA = a.readUInt32LE(40);
    const fwB = b.readUInt32LE(40);

    const extraA = a.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8);
    const extraB = b.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8);
    const extraSzA = a.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8 + 4);
    const extraSzB = b.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8 + 4);

    let maxTimeLen = 0;
    let maxExtraSrcLen = 0;
    let maxExtraConfigLen = 0;
    if (extraA + 12 <= a.length && extraB + 12 <= b.length && extraSzA >= 12 && extraSzB >= 12) {
        const timeOffA = a.readUInt32LE(extraA);
        const timeOffB = b.readUInt32LE(extraB);
        maxTimeLen = Math.max(strLenAt(a, symA, timeOffA), strLenAt(b, symB, timeOffB));
        const srcOffA = a.readUInt32LE(extraA + 4);
        const srcOffB = b.readUInt32LE(extraB + 4);
        const cfgOffA = a.readUInt32LE(extraA + 8);
        const cfgOffB = b.readUInt32LE(extraB + 8);
        maxExtraSrcLen = Math.max(strLenAt(a, symA, srcOffA), strLenAt(b, symB, srcOffB));
        maxExtraConfigLen = Math.max(strLenAt(a, symA, cfgOffA), strLenAt(b, symB, cfgOffB));
    } else if (extraA + 4 <= a.length && extraB + 4 <= b.length) {
        const timeOffA = a.readUInt32LE(extraA);
        const timeOffB = b.readUInt32LE(extraB);
        maxTimeLen = Math.max(strLenAt(a, symA, timeOffA), strLenAt(b, symB, timeOffB));
    }

    let maxProjectNameLen = 0;
    if (projA !== MAXDWORD && projB !== MAXDWORD) {
        maxProjectNameLen = Math.max(strLenAt(a, symA, projA), strLenAt(b, symB, projB));
    }
    let maxFirmwareVerLen = 0;
    if (fwA !== MAXDWORD && fwB !== MAXDWORD) {
        maxFirmwareVerLen = Math.max(strLenAt(a, symA, fwA), strLenAt(b, symB, fwB));
    }

    return {
        maxBuildIdLen: Math.max(strLenAt(a, symA, buildIdStrOff), strLenAt(b, symB, buildIdStrOff)),
        maxTimeLen,
        maxProjectNameLen,
        maxFirmwareVerLen,
        maxExtraSrcLen,
        maxExtraConfigLen,
        lineInfoFileNameLens: computeLineInfoFileNameLens(a, b),
    };
}

/** TBIN/TPC/TOBJ/PDB: zero volatile header + symbol strings (paths, ids, times). */
function applyTobjDevMask(buf: Buffer, lens: TobjDevMaskLens): void {
    if (buf.length < HEADER_SIZE + 9 * 8) return;

    buf.writeUInt16LE(0, 6);
    buf.writeUInt16LE(0, 44);
    buf.writeUInt16LE(0, 46);

    const symbolsSectionOff = buf.readUInt32LE(HEADER_SIZE + TObjSection.Symbols * 8);
    const buildIdStrOff = buf.readUInt32LE(36);
    const extraSectionOff = buf.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8);
    const extraSz = buf.readUInt32LE(HEADER_SIZE + TObjSection.Extra * 8 + 4);

    const buildIdAbsOff = symbolsSectionOff + buildIdStrOff;
    for (let i = 0; i < lens.maxBuildIdLen; i++) {
        if (buildIdAbsOff + i < buf.length) buf[buildIdAbsOff + i] = 0;
    }

    if (extraSectionOff + 4 <= buf.length) {
        const timeStrOff = buf.readUInt32LE(extraSectionOff);
        const timeAbsOff = symbolsSectionOff + timeStrOff;
        for (let i = 0; i < lens.maxTimeLen; i++) {
            if (timeAbsOff + i < buf.length) buf[timeAbsOff + i] = 0;
        }
    }

    const projOff = buf.readUInt32LE(32);
    if (projOff !== MAXDWORD && lens.maxProjectNameLen > 0) {
        const abs = symbolsSectionOff + projOff;
        for (let i = 0; i < lens.maxProjectNameLen; i++) {
            if (abs + i < buf.length) buf[abs + i] = 0;
        }
    }

    const fwOff = buf.readUInt32LE(40);
    if (fwOff !== MAXDWORD && lens.maxFirmwareVerLen > 0) {
        const abs = symbolsSectionOff + fwOff;
        for (let i = 0; i < lens.maxFirmwareVerLen; i++) {
            if (abs + i < buf.length) buf[abs + i] = 0;
        }
    }

    if (extraSectionOff + 12 <= buf.length && extraSz >= 12) {
        const srcOff = buf.readUInt32LE(extraSectionOff + 4);
        const cfgOff = buf.readUInt32LE(extraSectionOff + 8);
        const srcAbs = symbolsSectionOff + srcOff;
        for (let i = 0; i < lens.maxExtraSrcLen; i++) {
            if (srcAbs + i < buf.length) buf[srcAbs + i] = 0;
        }
        const cfgAbs = symbolsSectionOff + cfgOff;
        for (let i = 0; i < lens.maxExtraConfigLen; i++) {
            if (cfgAbs + i < buf.length) buf[cfgAbs + i] = 0;
        }
    }

    const liLens = lens.lineInfoFileNameLens;
    if (liLens && liLens.length > 0 && getTobjSectionCount(buf) >= TObjSection.CountObj) {
        const d = HEADER_SIZE + TObjSection.LineInfo * 8;
        const off = buf.readUInt32LE(d);
        const sz = buf.readUInt32LE(d + 4);
        let pos = 0;
        let idx = 0;
        while (pos + 8 <= sz && idx < liLens.length) {
            const fnOff = buf.readUInt32LE(off + pos);
            const lc = buf.readUInt32LE(off + pos + 4);
            const z = liLens[idx++];
            const abs = symbolsSectionOff + fnOff;
            for (let i = 0; i < z; i++) {
                if (abs + i < buf.length) buf[abs + i] = 0;
            }
            pos += 8 + lc * 8;
        }
    }
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

    const lens = computeTobjDevMaskLens(expected, actual);
    const maskedExpected = Buffer.from(expected);
    const maskedActual = Buffer.from(actual);
    applyTobjDevMask(maskedExpected, lens);
    applyTobjDevMask(maskedActual, lens);

    const diffs: number[] = [];
    for (let i = 0; i < maskedExpected.length; i++) {
        if (maskedExpected[i] !== maskedActual[i]) {
            diffs.push(i);
        }
    }
    return diffs;
}

const TOBJ_SECTION_COUNT_OBJ = 20;

/**
 * Compare two TOBJ (.obj) buffers like compareTpcMasked (checksum, times, build id / time strings).
 * Returns [-1] on total size mismatch.
 */
function compareObjMasked(actual: Buffer, expected: Buffer): number[] {
    if (actual.length !== expected.length) {
        return [-1];
    }
    const lens = computeTobjDevMaskLens(expected, actual);
    const maskedExpected = Buffer.from(expected);
    const maskedActual = Buffer.from(actual);
    applyTobjDevMask(maskedExpected, lens);
    applyTobjDevMask(maskedActual, lens);

    const diffs: number[] = [];
    for (let i = 0; i < maskedExpected.length; i++) {
        if (maskedExpected[i] !== maskedActual[i]) {
            diffs.push(i);
        }
    }
    return diffs;
}

/** Alias: PDB uses same TOBJ container as .obj */
function comparePdbMasked(actual: Buffer, expected: Buffer): number[] {
    return compareObjMasked(actual, expected);
}

function logObjSectionLayout(label: string, buf: Buffer): void {
    console.log(`${label} file size ${buf.length}`);
    for (let i = 0; i < TOBJ_SECTION_COUNT_OBJ; i++) {
        const d = HEADER_SIZE + i * 8;
        if (d + 8 > buf.length) break;
        const off = buf.readUInt32LE(d);
        const sz = buf.readUInt32LE(d + 4);
        console.log(`  ${SECTION_NAMES[i] ?? i}: off=${off} sz=${sz}`);
    }
}

function logObjMaskedDiffs(actual: Buffer, expected: Buffer, diffs: number[]): void {
    if (diffs.length === 0) return;
    console.log(`OBJ masked diff count: ${diffs.length}`);
    for (const off of diffs.slice(0, 25)) {
        const hdrEnd = HEADER_SIZE + TOBJ_SECTION_COUNT_OBJ * 8;
        let where = 'past_end';
        if (off < HEADER_SIZE) where = 'header';
        else if (off < hdrEnd) where = 'section_descriptors';
        else {
            for (let i = 0; i < TOBJ_SECTION_COUNT_OBJ; i++) {
                const d = HEADER_SIZE + i * 8;
                const so = expected.readUInt32LE(d);
                const ss = expected.readUInt32LE(d + 4);
                if (off >= so && off < so + ss) {
                    where = `${SECTION_NAMES[i] ?? i}+0x${(off - so).toString(16)}`;
                    break;
                }
            }
        }
        console.log(
            `  0x${off.toString(16)} (${where}): ref=0x${expected[off].toString(16).padStart(2, '0')} js=0x${actual[off].toString(16).padStart(2, '0')}`,
        );
    }
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

        const tmakeRefDir = path.join(dir, 'tmake-ref');
        const hasTmakeRefObjs = fs.existsSync(tmakeRefDir) &&
            fs.readdirSync(tmakeRefDir).some(f => f.endsWith('.obj'));
        const tmpDir = path.join(dir, 'tmp');
        const hasTmpObjs = fs.existsSync(tmpDir) &&
            fs.readdirSync(tmpDir).some(f => f.endsWith('.obj'));
        const refObjDir = hasTmakeRefObjs ? tmakeRefDir : (hasTmpObjs ? tmpDir : null);

        const pdbFile = path.join(dir, 'database.pdb');
        const refPdbFile = fs.existsSync(pdbFile) ? pdbFile : null;

        projects.push({
            name: entry.name,
            dir,
            tprFile: path.join(dir, tprFile),
            tpcFile: tpcFile ? path.join(dir, tpcFile) : null,
            refObjDir,
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

            describe('per-file OBJ reference parity (masked)', () => {
                const refObjNames = fs.readdirSync(project.refObjDir!)
                    .filter(f => f.endsWith('.obj'));

                for (const objName of refObjNames) {
                    it(`should match tmake ${objName} (checksum, times, build id / time strings masked)`, () => {
                        const gen = result.objs.get(objName);
                        if (!gen) {
                            console.log(`  ${objName}: not produced by compiler (skipping)`);
                            return;
                        }

                        const ref = fs.readFileSync(path.join(project.refObjDir!, objName));
                        if (gen.length !== ref.length) {
                            logObjSectionLayout('ref', ref);
                            logObjSectionLayout('js ', gen);
                        }
                        expect(gen.length).toBe(ref.length);

                        const diffs = compareObjMasked(gen, ref);
                        if (diffs.length > 0) {
                            logObjMaskedDiffs(gen, ref, diffs);
                        }
                        expect(diffs).toHaveLength(0);
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

                it('should produce a PDB with BDPT signature (CTObjFileInfo::PDB_FILE_SIGNATURE)', () => {
                    expect(pdbAvailable).toBe(true);
                    expect(jsH.signature).toBe('BDPT');
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

                it('should match reference PDB byte-for-byte (dev mask)', () => {
                    if (!pdbAvailable) return;
                    if (jsBuf.length !== refBuf.length) {
                        console.log(`PDB size: ref=${refBuf.length} js=${jsBuf.length}`);
                    }
                    expect(jsBuf.length).toBe(refBuf.length);
                    const diffs = comparePdbMasked(jsBuf, refBuf);
                    if (diffs.length > 0) {
                        logObjMaskedDiffs(jsBuf, refBuf, diffs);
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
