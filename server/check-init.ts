import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler } from './src/compiler/project';
import { TOBJ_SIGNATURE_OBJ, TObjSection, HEADER_SIZE, TObjAddressFlags } from './src/compiler/tobj/format';

const projectPath = path.resolve(__dirname, 'tests/blank');
const compiler = new ProjectCompiler(projectPath);
const result = compiler.compile();
const refDir = path.join(projectPath, 'tmp1');

console.log('Errors:', result.errors.length);
for (const e of result.errors.slice(0, 5)) {
    console.log('  ERR:', e.location.file + ':' + e.location.line, e.message);
}

function readSection(buf: Buffer, section: number): Buffer {
    const off = buf.readUInt32LE(HEADER_SIZE + section * 8);
    const sz = buf.readUInt32LE(HEADER_SIZE + section * 8 + 4);
    return buf.slice(off, off + sz);
}

for (const [name, buf] of result.objs) {
    if (buf.readUInt32LE(0) !== TOBJ_SIGNATURE_OBJ) continue;

    const jsInit = readSection(buf, TObjSection.Init);
    const jsRdata = readSection(buf, TObjSection.RData);
    const jsCode = readSection(buf, TObjSection.Code);
    console.log(`\nJS ${name}: init=${jsInit.length} code=${jsCode.length} rdata=${jsRdata.length} globalAlloc=${buf.readUInt32LE(16)}`);

    if (jsRdata.length > 0) {
        console.log(`  JS rdata: ${jsRdata.toString('hex')}`);
    }

    const jsRdataDir = readSection(buf, TObjSection.RDataDir);
    if (jsRdataDir.length > 0) {
        let pos = 0;
        while (pos + 12 <= jsRdataDir.length) {
            const rdOff = jsRdataDir.readUInt32LE(pos); pos += 4;
            const rdSz = jsRdataDir.readUInt32LE(pos); pos += 4;
            const refCount = jsRdataDir.readUInt32LE(pos); pos += 4;
            const refs: string[] = [];
            for (let r = 0; r < refCount; r++) {
                if (pos + 5 > jsRdataDir.length) break;
                const refType = jsRdataDir.readUInt8(pos); pos += 1;
                const refOffset = jsRdataDir.readUInt32LE(pos); pos += 4;
                refs.push(`${['code','init','rdata','data'][refType]||refType}@${refOffset}`);
            }
            console.log(`  JS rdataDir: rdOff=${rdOff} rdSz=${rdSz} refs=[${refs.join(', ')}]`);
        }
    }

    const refPath = path.join(refDir, name);
    if (!fs.existsSync(refPath)) continue;
    const ref = fs.readFileSync(refPath);

    const refInit = readSection(ref, TObjSection.Init);
    const refRdata = readSection(ref, TObjSection.RData);
    const refCode = readSection(ref, TObjSection.Code);
    console.log(`RF ${name}: init=${refInit.length} code=${refCode.length} rdata=${refRdata.length} globalAlloc=${ref.readUInt32LE(16)}`);

    if (refRdata.length > 0) {
        console.log(`  RF rdata: ${refRdata.toString('hex')}`);
    }

    const refRdataDir = readSection(ref, TObjSection.RDataDir);
    if (refRdataDir.length > 0) {
        let pos = 0;
        while (pos + 12 <= refRdataDir.length) {
            const rdOff = refRdataDir.readUInt32LE(pos); pos += 4;
            const rdSz = refRdataDir.readUInt32LE(pos); pos += 4;
            const refCount = refRdataDir.readUInt32LE(pos); pos += 4;
            const refs: string[] = [];
            for (let r = 0; r < refCount; r++) {
                if (pos + 5 > refRdataDir.length) break;
                const refType = refRdataDir.readUInt8(pos); pos += 1;
                const refOffset = refRdataDir.readUInt32LE(pos); pos += 4;
                refs.push(`${['code','init','rdata','data'][refType]||refType}@${refOffset}`);
            }
            console.log(`  RF rdataDir: rdOff=${rdOff} rdSz=${rdSz} refs=[${refs.join(', ')}]`);
        }
    }

    if (jsInit.length > 0 && refInit.length > 0) {
        for (let i = 0; i < Math.max(jsInit.length, refInit.length); i++) {
            const jb = i < jsInit.length ? jsInit[i] : -1;
            const rb = i < refInit.length ? refInit[i] : -1;
            if (jb !== rb) console.log(`  init diff @${i}: js=0x${jb >= 0 ? jb.toString(16).padStart(2,'0') : 'N/A'} ref=0x${rb >= 0 ? rb.toString(16).padStart(2,'0') : 'N/A'}`);
        }
    }
}

for (const [name, buf] of result.objs) {
    if (buf.readUInt32LE(0) !== TOBJ_SIGNATURE_OBJ) continue;
    const refPath = path.join(refDir, name);
    if (!fs.existsSync(refPath)) continue;
    const ref = fs.readFileSync(refPath);
    const jsCode = readSection(buf, TObjSection.Code);
    const refCode = readSection(ref, TObjSection.Code);
    let diffCount = 0;
    for (let i = 0; i < Math.max(jsCode.length, refCode.length) && diffCount < 15; i++) {
        if (i >= jsCode.length || i >= refCode.length || jsCode[i] !== refCode[i]) {
            const jb = i < jsCode.length ? jsCode[i] : -1;
            const rb = i < refCode.length ? refCode[i] : -1;
            console.log(`  OBJ code diff ${name} @${i}: js=0x${jb >= 0 ? jb.toString(16).padStart(2,'0') : 'NA'} ref=0x${rb >= 0 ? rb.toString(16).padStart(2,'0') : 'NA'}`);
            diffCount++;
        }
    }
    if (diffCount === 0) console.log(`  OBJ code ${name}: MATCH`);
}

if (result.tpc) {
    console.log('\n=== TPC comparison ===');
    const tpc = result.tpc;
    console.log(`JS TPC: globalAlloc=${tpc.readUInt32LE(16)} platformSize=${tpc.readUInt32LE(12)} stackSize=${tpc.readUInt32LE(20)} localAlloc=${tpc.readUInt32LE(24)}`);

    const codeOff = tpc.readUInt32LE(HEADER_SIZE);
    const codeSize = tpc.readUInt32LE(HEADER_SIZE + 4);
    const codeData = tpc.slice(codeOff, codeOff + codeSize);

    const jsRdata = readSection(tpc, TObjSection.RData);
    console.log(`JS TPC rdata (${jsRdata.length} bytes): ${jsRdata.toString('hex')}`);

    const refTpcPath = path.join(refDir, 'blank.tpc');
    if (fs.existsSync(refTpcPath)) {
        const ref = fs.readFileSync(refTpcPath);
        console.log(`RF TPC: globalAlloc=${ref.readUInt32LE(16)} platformSize=${ref.readUInt32LE(12)} stackSize=${ref.readUInt32LE(20)} localAlloc=${ref.readUInt32LE(24)}`);

        const refCodeOff = ref.readUInt32LE(HEADER_SIZE);
        const refCodeSize = ref.readUInt32LE(HEADER_SIZE + 4);
        const refCodeData = ref.slice(refCodeOff, refCodeOff + refCodeSize);

        const refRdata = readSection(ref, TObjSection.RData);
        console.log(`RF TPC rdata (${refRdata.length} bytes): ${refRdata.toString('hex')}`);

        let diffCount = 0;
        for (let i = 0; i < Math.max(codeData.length, refCodeData.length) && diffCount < 30; i++) {
            const jb = i < codeData.length ? codeData[i] : -1;
            const rb = i < refCodeData.length ? refCodeData[i] : -1;
            if (jb !== rb) {
                console.log(`  code diff @${i}: js=0x${jb >= 0 ? jb.toString(16).padStart(2,'0') : 'N/A'} ref=0x${rb >= 0 ? rb.toString(16).padStart(2,'0') : 'N/A'}`);
                diffCount++;
            }
        }
        if (diffCount === 0) console.log('  Code sections match!');
    }
}
