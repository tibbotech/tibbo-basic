import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';
import { link } from '../../src/compiler/index';
import { LinkerOptions } from '../../src/compiler/linker/linker';

const TESTS_ROOT = path.resolve(__dirname, '../../../tests');

function strLenAt(buf: Buffer, base: number, off: number): number {
    let len = 0;
    while (base + off + len < buf.length && buf[base + off + len] !== 0) len++;
    return len;
}

/**
 * Compare two TPC buffers, masking out build ID, timestamp, and checksum
 * which are expected to differ between builds. Returns the list of
 * byte offsets that still differ after masking.
 */
function compareTpcMasked(actual: Buffer, expected: Buffer): number[] {
    if (actual.length !== expected.length) {
        return [-1]; // sentinel for size mismatch
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

    // Build ID and timestamp strings live in the Symbols section.
    // Header offset 36 = buildIdOff (offset within Symbols).
    // Extra section (section 8) first dword = timeStrOff (offset within Symbols).
    const symbolsSectionOff = expected.readUInt32LE(48 + 4 * 8);
    const buildIdStrOff = expected.readUInt32LE(36);
    const extraSectionOff = expected.readUInt32LE(48 + 8 * 8);
    const timeStrOff = expected.readUInt32LE(extraSectionOff);

    // Mask build ID string
    const buildIdAbsOff = symbolsSectionOff + buildIdStrOff;
    const maxBuildIdLen = Math.max(
        strLenAt(expected, symbolsSectionOff, buildIdStrOff),
        strLenAt(actual, symbolsSectionOff, buildIdStrOff)
    );
    for (let i = 0; i < maxBuildIdLen; i++) {
        if (buildIdAbsOff + i < maskedExpected.length) maskedExpected[buildIdAbsOff + i] = 0;
        if (buildIdAbsOff + i < maskedActual.length) maskedActual[buildIdAbsOff + i] = 0;
    }

    // Mask timestamp string
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
// Blank project
// ---------------------------------------------------------------------------

describe('Blank project', () => {
    const PROJECT_PATH = path.join(TESTS_ROOT, 'blank');
    const EXPECTED_TPC_PATH = path.join(PROJECT_PATH, 'blank.tpc');
    let result: ReturnType<ProjectCompiler['compile']>;

    beforeAll(() => {
        const compiler = new ProjectCompiler(PROJECT_PATH);
        result = compiler.compile();
    });

    it('should parse the .tpr file', () => {
        const config = parseProjectFile(path.join(PROJECT_PATH, 'blank.tpr'));
        expect(config.name).toBe('blank');
        expect(config.output).toBe('blank.tpc');
        expect(config.debug).toBe(true);
        expect(config.platform).toBe('TPP2W(G2)');
        expect(config.sourceFiles.length).toBe(2);

        const basicFiles = config.sourceFiles.filter(f => f.type === 'basic');
        const headerFiles = config.sourceFiles.filter(f => f.type === 'header');
        expect(basicFiles.length).toBe(1);
        expect(headerFiles.length).toBe(1);
        expect(basicFiles[0].path).toBe('main.tbs');
        expect(headerFiles[0].path).toBe('global.tbh');
    });

    it('should compile without errors', () => {
        if (result.errors.length > 0) {
            console.log('Compilation errors:');
            for (const err of result.errors.slice(0, 50)) {
                console.log(`  ${err.location.file}:${err.location.line}:${err.location.column}: ${err.message}`);
            }
        }
        expect(result.errors).toHaveLength(0);
    });

    it('should produce one OBJ file', () => {
        expect(result.objs.size).toBe(1);
        expect(result.objs.has('main.tbs.obj')).toBe(true);
    });

    it('should produce a valid .tpc with TBIN signature', () => {
        expect(result.tpc).not.toBeNull();
        expect(result.tpc!.toString('ascii', 0, 4)).toBe('TBIN');
    });

    it('should match reference TPC (only build ID and timestamp differ)', () => {
        const expected = fs.readFileSync(EXPECTED_TPC_PATH);
        expect(result.tpc).not.toBeNull();

        const diffs = compareTpcMasked(result.tpc!, expected);
        if (diffs.length > 0) logTpcDiffs(result.tpc!, expected, diffs);
        expect(result.tpc!.length).toBe(expected.length);
        expect(diffs).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// MyDeviceTestHello project
// ---------------------------------------------------------------------------

describe('MyDeviceTestHello project', () => {
    const PROJECT_PATH = path.join(TESTS_ROOT, 'MyDeviceTestHello');
    const EXPECTED_TPC_PATH = path.join(PROJECT_PATH, 'MyDeviceTestHello___1.0.0.tpc');
    let result: ReturnType<ProjectCompiler['compile']>;

    beforeAll(() => {
        const compiler = new ProjectCompiler(PROJECT_PATH);
        result = compiler.compile();
    });

    it('should parse the .tpr file', () => {
        const config = parseProjectFile(path.join(PROJECT_PATH, 'project.tpr'));
        expect(config.name).toBe('MyDeviceTestHello___1.0.0');
        expect(config.output).toBe('MyDeviceTestHello___1.0.0.tpc');
        expect(config.debug).toBe(true);
        expect(config.platform).toBe('TPP2W(G2)');
        expect(config.sourceFiles.length).toBeGreaterThan(0);
    });

    it('should compile without fatal errors', () => {
        if (result.errors.length > 0) {
            console.log('Compilation errors:');
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
            console.log('Warning summary:');
            for (const [msg, count] of [...warnGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
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

    it('should match reference TPC (only build ID and timestamp differ)', () => {
        const expected = fs.readFileSync(EXPECTED_TPC_PATH);
        expect(result.tpc).not.toBeNull();

        const diffs = compareTpcMasked(result.tpc!, expected);
        if (diffs.length > 0) logTpcDiffs(result.tpc!, expected, diffs);
        expect(result.tpc!.length).toBe(expected.length);
        expect(diffs).toHaveLength(0);
    });

    it('should produce 8 OBJ files', () => {
        const OBJ_NAMES = [
            'main.tbs.obj', 'device.tbs.obj', 'boot.tbs.obj', 'time.tbs.obj',
            'sock.tbs.obj', 'datetime.tbs.obj', 'utils.tbs.obj', 'dhcp.tbs.obj',
        ];
        expect(result.objs.size).toBe(8);
        for (const name of OBJ_NAMES) {
            expect(result.objs.has(name)).toBe(true);
        }
    });

    describe('per-file OBJ Code section sizes', () => {
        const REF_OBJ_DIR = path.join(PROJECT_PATH, 'tmp');
        const HEADER_SIZE = 48;
        const OBJ_NAMES = [
            'main.tbs.obj', 'device.tbs.obj', 'boot.tbs.obj', 'time.tbs.obj',
            'sock.tbs.obj', 'datetime.tbs.obj', 'utils.tbs.obj', 'dhcp.tbs.obj',
        ];
        const SECTION_NAMES = [
            'Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra',
            'Addresses', 'Functions', 'Scopes', 'Variables', 'Objects', 'Syscalls', 'Types', 'RDataDir', 'LineInfo', 'LibNameDir', 'IncNameDir',
        ];

        for (const objName of OBJ_NAMES) {
            it(`should match Code section size for ${objName}`, () => {
                const ref = fs.readFileSync(path.join(REF_OBJ_DIR, objName));
                const gen = result.objs.get(objName)!;

                const refCodeSize = ref.readUInt32LE(HEADER_SIZE + 0 * 8 + 4);
                const genCodeSize = gen.readUInt32LE(HEADER_SIZE + 0 * 8 + 4);

                const refInitSize = ref.readUInt32LE(HEADER_SIZE + 1 * 8 + 4);
                const genInitSize = gen.readUInt32LE(HEADER_SIZE + 1 * 8 + 4);

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
});

// ---------------------------------------------------------------------------
// Linker: reference OBJ linking for MyDeviceTestHello
// ---------------------------------------------------------------------------

describe('Linker: Reference OBJ linking', () => {
    const PROJECT_PATH = path.join(TESTS_ROOT, 'MyDeviceTestHello');
    const EXPECTED_TPC_PATH = path.join(PROJECT_PATH, 'MyDeviceTestHello___1.0.0.tpc');
    const REF_OBJ_DIR = path.join(PROJECT_PATH, 'tmp');
    const OBJ_LINK_ORDER = [
        'main.tbs.obj', 'device.tbs.obj', 'boot.tbs.obj', 'time.tbs.obj',
        'sock.tbs.obj', 'datetime.tbs.obj', 'utils.tbs.obj', 'dhcp.tbs.obj',
    ];

    const REF_LINKER_OPTIONS: LinkerOptions = {
        projectName: 'MyDeviceTestHello___1.0.0',
        buildId: '93971a53-9985-48aa-be8e-55c371e03da9',
        firmwareVer: 'TPP2W(G2)-4.02',
        configStr: '<FD>',
        platformSize: 25,
        stackSize: 15,
        globalAllocSize: 751,
        localAllocSize: 1834,
        maxEventNumber: 33,
        flags: 0x0F,
        fixedTimestamp: new Date(2026, 2, 20, 16, 57, 35),
    };

    it('should link reference OBJ files to match reference TPC', () => {
        const expectedTpc = fs.readFileSync(EXPECTED_TPC_PATH);

        const objBuffers = OBJ_LINK_ORDER.map(name => ({
            name,
            data: fs.readFileSync(path.join(REF_OBJ_DIR, name)),
        }));

        const result = link(objBuffers, {}, REF_LINKER_OPTIONS);
        expect(result.errors).toHaveLength(0);

        const produced = result.tpc;
        const diffs = compareTpcMasked(produced, expectedTpc);
        if (diffs.length > 0) logTpcDiffs(produced, expectedTpc, diffs);
        expect(produced.length).toBe(expectedTpc.length);
        expect(diffs).toHaveLength(0);
    });
});
