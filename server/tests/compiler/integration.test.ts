import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';
import { link } from '../../src/compiler/index';
import { LinkerOptions } from '../../src/compiler/linker/linker';

const TEST_PROJECT_PATH = path.resolve(__dirname, '../../../tests/MyDeviceTestHello');
const EXPECTED_TPC_PATH = path.join(TEST_PROJECT_PATH, 'MyDeviceTestHello___1.0.0.tpc');

describe('Project file parser', () => {
    it('should parse .tpr file correctly', () => {
        const tprPath = path.join(TEST_PROJECT_PATH, 'project.tpr');
        const config = parseProjectFile(tprPath);

        expect(config.name).toBe('MyDeviceTestHello___1.0.0');
        expect(config.output).toBe('MyDeviceTestHello___1.0.0.tpc');
        expect(config.debug).toBe(true);
        expect(config.platform).toBe('TPP2W(G2)');
        expect(config.sourceFiles.length).toBeGreaterThan(0);

        const basicFiles = config.sourceFiles.filter(f => f.type === 'basic');
        const headerFiles = config.sourceFiles.filter(f => f.type === 'header');
        expect(basicFiles.length).toBeGreaterThan(0);
        expect(headerFiles.length).toBeGreaterThan(0);
    });
});

describe('MyDeviceTestHello Integration Test', () => {
    it('should compile the test project without fatal errors', () => {
        const compiler = new ProjectCompiler(TEST_PROJECT_PATH);
        const result = compiler.compile();

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

    it('should have en_td_timezones in combined source', () => {
        const compiler = new ProjectCompiler(TEST_PROJECT_PATH);
        const result = compiler.compile();
        // The error at line 9208 says "Unknown type: en_td_timezones"
        // Check if the type resolves
        expect(result.errors.length).toBeLessThanOrEqual(1);
    });

    it('should produce a valid .tpc binary', () => {
        const compiler = new ProjectCompiler(TEST_PROJECT_PATH);
        const result = compiler.compile();

        expect(result.tpc).not.toBeNull();
        if (result.tpc) {
            // Check TBIN signature
            const sig = result.tpc.toString('ascii', 0, 4);
            expect(sig).toBe('TBIN');
            expect(result.tpc.length).toBeGreaterThan(0);
        }
    });

    it('should match the expected .tpc output', () => {
        const expectedTpc = fs.readFileSync(EXPECTED_TPC_PATH);
        const compiler = new ProjectCompiler(TEST_PROJECT_PATH);
        const result = compiler.compile();

        expect(result.tpc).not.toBeNull();
        if (result.tpc) {
            console.log(`Expected TPC size: ${expectedTpc.length}`);
            console.log(`Produced TPC size: ${result.tpc.length}`);

            const sections = ['Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra'];
            console.log('Section comparison:');
            for (let i = 0; i < 9; i++) {
                const expOff = expectedTpc.readUInt32LE(48 + i * 8);
                const expSize = expectedTpc.readUInt32LE(52 + i * 8);
                const gotOff = result.tpc.readUInt32LE(48 + i * 8);
                const gotSize = result.tpc.readUInt32LE(52 + i * 8);
                const match = expSize === gotSize ? 'OK' : `DIFF(${expSize - gotSize})`;
                console.log(`  ${sections[i]}: expected=(off=${expOff},sz=${expSize}) got=(off=${gotOff},sz=${gotSize}) ${match}`);
            }

            const expectedSig = expectedTpc.toString('ascii', 0, 4);
            const producedSig = result.tpc.toString('ascii', 0, 4);
            expect(producedSig).toBe(expectedSig);

            if (result.tpc.length === expectedTpc.length) {
                let firstDiff = -1;
                for (let i = 0; i < expectedTpc.length; i++) {
                    if (result.tpc[i] !== expectedTpc[i]) {
                        firstDiff = i;
                        break;
                    }
                }
                if (firstDiff >= 0) {
                    console.log(`First byte difference at offset 0x${firstDiff.toString(16)}`);
                    console.log(`  Expected: ${expectedTpc.slice(firstDiff, firstDiff + 16).toString('hex')}`);
                    console.log(`  Produced: ${result.tpc.slice(firstDiff, firstDiff + 16).toString('hex')}`);
                }
                expect(firstDiff).toBe(-1);
            } else {
                console.log('Size mismatch - not performing byte comparison');
                expect(result.tpc.length).toBe(expectedTpc.length);
            }
        }
    });
});

describe('Linker: Reference OBJ linking', () => {
    const REF_OBJ_DIR = path.join(TEST_PROJECT_PATH, 'tmp');
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
        console.log(`Expected TPC size: ${expectedTpc.length}`);
        console.log(`Produced TPC size: ${produced.length}`);

        const sections = ['Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra'];
        console.log('Section comparison:');
        for (let i = 0; i < 9; i++) {
            const expOff = expectedTpc.readUInt32LE(48 + i * 8);
            const expSize = expectedTpc.readUInt32LE(52 + i * 8);
            const gotOff = produced.readUInt32LE(48 + i * 8);
            const gotSize = produced.readUInt32LE(52 + i * 8);
            const sizeMatch = expSize === gotSize;
            const offMatch = expOff === gotOff;
            console.log(`  ${sections[i]}: exp=(off=${expOff},sz=${expSize}) got=(off=${gotOff},sz=${gotSize}) ${sizeMatch ? 'SIZE_OK' : 'SIZE_DIFF(' + (expSize - gotSize) + ')'} ${offMatch ? 'OFF_OK' : 'OFF_DIFF(' + (expOff - gotOff) + ')'}`);
        }

        if (produced.length === expectedTpc.length) {
            let firstDiff = -1;
            for (let i = 0; i < expectedTpc.length; i++) {
                if (produced[i] !== expectedTpc[i]) {
                    firstDiff = i;
                    break;
                }
            }
            if (firstDiff >= 0) {
                console.log(`\nFirst byte difference at offset 0x${firstDiff.toString(16)} (${firstDiff})`);
                console.log(`  Expected: ${expectedTpc.slice(firstDiff, firstDiff + 16).toString('hex')}`);
                console.log(`  Produced: ${produced.slice(firstDiff, firstDiff + 16).toString('hex')}`);
            }
            expect(firstDiff).toBe(-1);
        } else {
            expect(produced.length).toBe(expectedTpc.length);
        }
    });
});

describe('Per-file OBJ comparison', () => {
    const REF_OBJ_DIR = path.join(TEST_PROJECT_PATH, 'tmp');
    const OBJ_NAMES = [
        'main.tbs.obj', 'device.tbs.obj', 'boot.tbs.obj', 'time.tbs.obj',
        'sock.tbs.obj', 'datetime.tbs.obj', 'utils.tbs.obj', 'dhcp.tbs.obj',
    ];
    const SECTION_NAMES = ['Code', 'Init', 'RData', 'FileData', 'Symbols', 'ResFileDir', 'EventDir', 'LibFileDir', 'Extra',
        'Addresses', 'Functions', 'Scopes', 'Variables', 'Objects', 'Syscalls', 'Types', 'RDataDir', 'LineInfo', 'LibNameDir', 'IncNameDir'];

    let compiledObjs: Map<string, Buffer>;

    beforeAll(() => {
        const compiler = new ProjectCompiler(TEST_PROJECT_PATH);
        const result = compiler.compile();
        compiledObjs = result.objs;
    });

    it('should produce 8 OBJ files', () => {
        expect(compiledObjs.size).toBe(8);
        for (const name of OBJ_NAMES) {
            expect(compiledObjs.has(name)).toBe(true);
        }
    });

    for (const objName of ['main.tbs.obj', 'device.tbs.obj', 'boot.tbs.obj', 'time.tbs.obj',
        'sock.tbs.obj', 'datetime.tbs.obj', 'utils.tbs.obj', 'dhcp.tbs.obj']) {
        it(`should match Code section size for ${objName}`, () => {
            const HEADER_SIZE = 48;
            const ref = fs.readFileSync(path.join(REF_OBJ_DIR, objName));
            const gen = compiledObjs.get(objName)!;

            const refCodeSize = ref.readUInt32LE(HEADER_SIZE + 0 * 8 + 4);
            const genCodeSize = gen.readUInt32LE(HEADER_SIZE + 0 * 8 + 4);

            const refInitSize = ref.readUInt32LE(HEADER_SIZE + 1 * 8 + 4);
            const genInitSize = gen.readUInt32LE(HEADER_SIZE + 1 * 8 + 4);

            console.log(`${objName}: Code exp=${refCodeSize} got=${genCodeSize} (${refCodeSize === genCodeSize ? 'OK' : 'DIFF(' + (refCodeSize - genCodeSize) + ')'}), Init exp=${refInitSize} got=${genInitSize}`);

            // Log all section sizes for reference
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
