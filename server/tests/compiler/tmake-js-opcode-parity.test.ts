import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as url from 'url';
import { execFileSync } from 'child_process';
import { ProjectCompiler } from '../../src/compiler/project';
import {
    disassembleBinarySectionToLines,
    disassembleBinaryToLines,
} from '../../src/compiler/dump-pdb-instructions';
import { TObjSection } from '../../src/compiler/tobj/format';
import ini = require('ini');

/** Parent of this folder: `server/tests` — Tibbo project fixtures live here and in its subfolders. */
const TESTS_ROOT = path.resolve(__dirname, '..', 'compiletests');

const buildURL = 'https://api.appblocks.io/api/projects/build';
/**
 * When Tibbo tmake is installed, for each immediate subfolder of `server/tests` that contains
 * a `.tpr`, runs tmake and reads `tmp/database.pdb`, then compiles with the JS compiler.
 * Compares decoded bytecode the same way as {@link disassembleBinaryToLines}: TBIN/PDB Code
 * section only (Init can differ by toolchain). Also asserts
 * {@link disassembleBinarySectionToLines} on TBIN Code matches that stream.
 */

function dirContainsTpr(dir: string): boolean {
    return fs.readdirSync(dir).some(f => f.endsWith('.tpr'));
}

/** Each direct child of `testsRoot` that is a directory and contains a `.tpr` project file. */
function discoverTprProjectDirs(testsRoot: string): string[] {
    const dirs: string[] = [];
    for (const ent of fs.readdirSync(testsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) {
            continue;
        }
        const full = path.join(testsRoot, ent.name);
        if (dirContainsTpr(full)) {
            dirs.push(full);
        }
    }
    return dirs.sort((a, b) => a.localeCompare(b, 'en'));
}

function projectLabel(projectDir: string): string {
    return path.relative(TESTS_ROOT, projectDir).split(path.sep).join('/');
}

const TPR_PROJECT_DIRS = discoverTprProjectDirs(TESTS_ROOT);

function findTprBasename(projectDir: string): string {
    const tpr = fs.readdirSync(projectDir).find(f => f.endsWith('.tpr'));
    if (!tpr) {
        throw new Error(`No .tpr in ${projectDir}`);
    }
    return tpr;
}

async function runTmake(projectDir: string): Promise<Buffer> {
    const platformsDir = path.join(projectDir, 'Platforms');
    const tmpDir = path.join(projectDir, 'tmp');
    if (fs.existsSync(tmpDir)) {
        for (const f of fs.readdirSync(tmpDir)) {
            fs.unlinkSync(path.join(tmpDir, f));
        }
    }
    let tprPath = '';
    fs.readdirSync(projectDir).forEach(file => {
        const ext = path.extname(file);
        if (ext == '.tpr') {
            tprPath = path.join(projectDir, file);
        }
    });
    const tpr = ini.parse(fs.readFileSync(tprPath, 'utf-8'));

    const files: { name: string, contents: string }[] = [];
    for (let i = 1; i < 99; i++) {
        const fileId = `file${i}`;
        if (tpr[fileId] === undefined) {
            break;
        }
        if (tpr[fileId].location === 'commonlib') {
            continue;
        }
        const fileName = tpr[fileId].path.replace('\\', path.sep);
        const filePath = path.join(projectDir, fileName);
        const parts = fileName.split('.');
        const extension = parts[parts.length - 1];
        let contents;
        switch (extension) {
            case 'gz':
            case 'bin':
            case 'bmp':
                contents = await fs.readFileSync(filePath);
                break;
            default:
                contents = await fs.readFileSync(filePath, 'utf-8');
                break;
        }
        files.push({
            name: fileName,
            contents: contents
        });
    }
    files.push({
        name: path.basename(tprPath),
        contents: await fs.readFileSync(tprPath, 'utf-8')
    });
    

    const project = {
        device: {
            id: tpr['project']['platform']
        },
        name: tpr['project']['name'],
    }
    try {
        const responseData = await new Promise<any>((resolve, reject) => {
            const payload = JSON.stringify({ files, project, debug: 'on', timeout: 1000 * 60 * 3 });
            const parsed = url.parse(buildURL);
            const req = https.request({
                hostname: parsed.hostname!,
                path: parsed.path!,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                    catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
        if (!responseData.pdb) {
            console.error(responseData);
            throw new Error('No data in response');
        }
        const pdbBuffer = Buffer.from(responseData.pdb.data);
        const tpcBuffer = Buffer.from(responseData.tpc.data);

        return pdbBuffer;
    } catch (error) {
        console.error(error);
        throw error;
    }
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

describe('tmake reference vs JS compiler opcodes (all server/tests *.tpr projects)', () => {
    it.concurrent.each(TPR_PROJECT_DIRS.map(d => [projectLabel(d), d] as const))(
        'matches disassembled Code: tmake PDB vs JS TPC (TBIN Code section) — %s',
        async (label, projectDir) => {
            // console.log(`compiling ${projectDir}`);
            const refPdb = await runTmake(projectDir);
            // save pdb to file
            fs.writeFileSync(path.join(projectDir, 'tmp','ref.pdb'), refPdb);
            const refFromPdb = disassembleBinaryToLines(refPdb);
            const refCodeSection = disassembleBinarySectionToLines(refPdb, TObjSection.Code);
            expect(refCodeSection).toEqual(refFromPdb);
            const platformsDir = path.join(projectDir, 'Platforms');
            let platformsPath = platformsDir;
            if (!fs.existsSync(platformsDir)) {
                // set to submodule platforms
                platformsPath = path.join(__dirname, '..', '..', '..', 'platforms', 'Platforms');
            }
            const compiler = new ProjectCompiler(projectDir, platformsPath);
            // see if platforms directory exists
            
            const result = compiler.compile();
            expect(result.errors).toHaveLength(0);
            expect(result.tpc).not.toBeNull();

            fs.writeFileSync(path.join(projectDir, 'tmp','ref.pdb'), refPdb);


            const jsTpc = result.tpc!;
            expect(jsTpc.toString('ascii', 0, 4)).toBe('TBIN');

            // the order of functions and variables might be different, so we need to match what is in the pdb
            // TODO modify the jsTpc to match the order of functions and variables in the refPdb
            


            const jsFromTpc = disassembleBinaryToLines(jsTpc);
            const jsCodeSection = disassembleBinarySectionToLines(jsTpc, TObjSection.Code);
            expect(jsCodeSection).toEqual(jsFromTpc);

            if (refFromPdb.length !== jsFromTpc.length) {
                logFirstMismatch(label, refFromPdb, jsFromTpc);
            }
            expect(jsFromTpc).toEqual(refFromPdb);
        },
    );
});
