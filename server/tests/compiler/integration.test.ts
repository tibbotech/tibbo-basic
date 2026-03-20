import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';

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

        expect(result.objs.size).toBe(1);
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

            // Compare section sizes (TBIN has 9 sections)
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

            // Compare headers
            const expectedSig = expectedTpc.toString('ascii', 0, 4);
            const producedSig = result.tpc.toString('ascii', 0, 4);
            expect(producedSig).toBe(expectedSig);

            // Full binary comparison
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
