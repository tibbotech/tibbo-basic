import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ProjectCompiler } from '../../src/compiler/project';
import {
    disassembleBinarySectionToLines,
    disassembleBinaryToLines,
} from '../../src/compiler/dump-pdb-instructions';
import { TObjSection } from '../../src/compiler/tobj/format';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TMAKE = String.raw`C:\Program Files (x86)\Tibbo\TIDE\Bin\tmake.exe`;

const tmakePath = process.env.TIBBO_TMAKE || process.env.TMAKE || DEFAULT_TMAKE;
const tmakeExists = fs.existsSync(tmakePath);

/**
 * When Tibbo tmake is installed, builds tests/blank with tmake and reads tmp/database.pdb,
 * then compiles with the JS compiler. Compares decoded bytecode the same way as
 * {@link disassembleBinaryToLines}: TBIN/PDB Code section only (Init can differ by toolchain).
 * Also asserts {@link disassembleBinarySectionToLines} on TBIN Code matches that stream.
 */
const describeTmake = tmakeExists ? describe : describe.skip;

function findTprBasename(projectDir: string): string {
    const tpr = fs.readdirSync(projectDir).find(f => f.endsWith('.tpr'));
    if (!tpr) {
        throw new Error(`No .tpr in ${projectDir}`);
    }
    return tpr;
}

function runTmake(projectDir: string): Buffer {
    const tpr = findTprBasename(projectDir);
    const platformsDir = path.join(projectDir, 'Platforms');
    const tmpDir = path.join(projectDir, 'tmp');
    if (fs.existsSync(tmpDir)) {
        for (const f of fs.readdirSync(tmpDir)) {
            fs.unlinkSync(path.join(tmpDir, f));
        }
    }
    execFileSync(tmakePath, [tpr, '-p', platformsDir], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 120_000,
    });
    const pdbPath = path.join(projectDir, 'tmp', 'database.pdb');
    if (!fs.existsSync(pdbPath)) {
        throw new Error(`tmake did not produce ${pdbPath}`);
    }
    return fs.readFileSync(pdbPath);
}

function logFirstMismatch(
    label: string,
    ref: string[],
    js: string[],
): void {
    const n = Math.min(ref.length, js.length);
    for (let i = 0; i < n; i++) {
        if (ref[i] !== js[i]) {
            console.log(`${label} first mismatch at instruction ${i}:`);
            console.log(`  tmake pdb: ${ref[i]}`);
            console.log(`  js tpc:    ${js[i]}`);
            return;
        }
    }
    if (ref.length !== js.length) {
        console.log(`${label}: length ref=${ref.length} js=${js.length}`);
    }
}

describeTmake('tmake reference vs JS compiler opcodes (tests/blank)', () => {
    const projectDir = path.join(REPO_ROOT, 'tests', 'blank');

    it('matches disassembled Code: tmake PDB vs JS TPC (TBIN Code section)', () => {
        const refPdb = runTmake(projectDir);

        const refFromPdb = disassembleBinaryToLines(refPdb);
        const refCodeSection = disassembleBinarySectionToLines(refPdb, TObjSection.Code);
        expect(refCodeSection).toEqual(refFromPdb);

        const compiler = new ProjectCompiler(projectDir);
        const result = compiler.compile();
        expect(result.errors).toHaveLength(0);
        expect(result.tpc).not.toBeNull();

        const jsTpc = result.tpc!;
        expect(jsTpc.toString('ascii', 0, 4)).toBe('TBIN');

        const jsFromTpc = disassembleBinaryToLines(jsTpc);
        const jsCodeSection = disassembleBinarySectionToLines(jsTpc, TObjSection.Code);
        expect(jsCodeSection).toEqual(jsFromTpc);

        if (refFromPdb.length !== jsFromTpc.length) {
            logFirstMismatch('Code', refFromPdb, jsFromTpc);
        }
        expect(jsFromTpc).toEqual(refFromPdb);
    });
});
