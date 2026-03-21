import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler, parseProjectFile } from '../../src/compiler/project';

const BLANK_PROJECT_PATH = path.resolve(__dirname, '../../../tests/blank');
const EXPECTED_TPC_PATH = path.join(BLANK_PROJECT_PATH, 'blank.tpc');

describe('Blank project parser', () => {
    it('should parse the blank .tpr file', () => {
        const tprPath = path.join(BLANK_PROJECT_PATH, 'blank.tpr');
        const config = parseProjectFile(tprPath);

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
});

describe('Blank project compilation', () => {
    let result: ReturnType<ProjectCompiler['compile']>;

    beforeAll(() => {
        const compiler = new ProjectCompiler(BLANK_PROJECT_PATH);
        result = compiler.compile();
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

    it('should produce a valid .tpc binary with TBIN signature', () => {
        expect(result.tpc).not.toBeNull();
        if (result.tpc) {
            expect(result.tpc.toString('ascii', 0, 4)).toBe('TBIN');
        }
    });

    it('should match reference blank.tpc except for build ID and timestamp', () => {
        const expected = fs.readFileSync(EXPECTED_TPC_PATH);
        expect(result.tpc).not.toBeNull();
        if (!result.tpc) return;

        expect(result.tpc.length).toBe(expected.length);

        const actual = Buffer.from(result.tpc);

        // Locate the variable regions: build ID string and timestamp string
        // Both live inside the Symbols section as null-terminated strings.
        // Header offset 36 = buildIdOff (offset into Symbols of the build ID)
        // Extra section dword 0 = timeStrOff (offset into Symbols of the timestamp)
        const symbolsSectionOff = expected.readUInt32LE(48 + 4 * 8);  // section 4 = Symbols offset
        const symbolsSectionSize = expected.readUInt32LE(52 + 4 * 8); // section 4 = Symbols size

        const buildIdStrOff = expected.readUInt32LE(36);   // offset within Symbols
        const extraSectionOff = expected.readUInt32LE(48 + 8 * 8); // section 8 = Extra offset
        const timeStrOff = expected.readUInt32LE(extraSectionOff);  // first dword of Extra

        // Find string lengths by scanning for null terminators in the reference
        function strLenAt(buf: Buffer, base: number, off: number): number {
            let len = 0;
            while (base + off + len < buf.length && buf[base + off + len] !== 0) len++;
            return len;
        }

        const buildIdLen = strLenAt(expected, symbolsSectionOff, buildIdStrOff);
        const timeStrLen = strLenAt(expected, symbolsSectionOff, timeStrOff);

        // Zero out the variable regions in both buffers before comparing
        const maskedExpected = Buffer.from(expected);
        const maskedActual = Buffer.from(actual);

        // Checksum (bytes 6-7) depends on content, so it will differ
        maskedExpected.writeUInt16LE(0, 6);
        maskedActual.writeUInt16LE(0, 6);

        // Header timestamp fields: daysSince2000 (44-45) and minutesOfDay (46-47)
        maskedExpected.writeUInt16LE(0, 44);
        maskedActual.writeUInt16LE(0, 44);
        maskedExpected.writeUInt16LE(0, 46);
        maskedActual.writeUInt16LE(0, 46);

        // Build ID string in Symbols section
        const buildIdAbsOff = symbolsSectionOff + buildIdStrOff;
        const buildIdActualLen = strLenAt(actual, symbolsSectionOff, buildIdStrOff);
        const maxBuildIdLen = Math.max(buildIdLen, buildIdActualLen);
        for (let i = 0; i < maxBuildIdLen; i++) {
            if (buildIdAbsOff + i < maskedExpected.length) maskedExpected[buildIdAbsOff + i] = 0;
            if (buildIdAbsOff + i < maskedActual.length) maskedActual[buildIdAbsOff + i] = 0;
        }

        // Timestamp string in Symbols section
        const timeAbsOff = symbolsSectionOff + timeStrOff;
        const timeActualLen = strLenAt(actual, symbolsSectionOff, timeStrOff);
        const maxTimeLen = Math.max(timeStrLen, timeActualLen);
        for (let i = 0; i < maxTimeLen; i++) {
            if (timeAbsOff + i < maskedExpected.length) maskedExpected[timeAbsOff + i] = 0;
            if (timeAbsOff + i < maskedActual.length) maskedActual[timeAbsOff + i] = 0;
        }

        // Compare masked buffers
        const diffs: number[] = [];
        for (let i = 0; i < maskedExpected.length; i++) {
            if (maskedExpected[i] !== maskedActual[i]) {
                diffs.push(i);
            }
        }

        if (diffs.length > 0) {
            console.log(`Unexpected diffs at ${diffs.length} byte(s):`);
            for (const off of diffs.slice(0, 20)) {
                console.log(`  0x${off.toString(16)}: expected=0x${expected[off].toString(16).padStart(2,'0')} actual=0x${actual[off].toString(16).padStart(2,'0')}`);
            }
        }

        expect(diffs).toHaveLength(0);
    });
});
