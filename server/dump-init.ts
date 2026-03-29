import * as path from 'path';
import * as fs from 'fs';
import { ProjectCompiler } from './src/compiler/project';
import {
    TOBJ_SIGNATURE_OBJ, TObjSection, HEADER_SIZE,
} from './src/compiler/tobj/format';

const projectPath = path.resolve(__dirname, '../tests/MyDeviceTestHello');
const compiler = new ProjectCompiler(projectPath);
const result = compiler.compile();

console.log('Errors:', result.errors.length);
for (const e of result.errors.slice(0, 5)) {
    console.log('  ERR:', e.location.file + ':' + e.location.line, e.message);
}

console.log('\n=== Per-OBJ sections ===');
for (const [name, buf] of result.objs) {
    const sig = buf.readUInt32LE(0);
    if (sig !== TOBJ_SIGNATURE_OBJ) { console.log(name, 'bad sig'); continue; }
    const dStart = HEADER_SIZE;
    const objInitOff = buf.readUInt32LE(dStart + TObjSection.Init * 8);
    const objInitSize = buf.readUInt32LE(dStart + TObjSection.Init * 8 + 4);
    const objCodeOff = buf.readUInt32LE(dStart + TObjSection.Code * 8);
    const objCodeSize = buf.readUInt32LE(dStart + TObjSection.Code * 8 + 4);
    const globalAlloc = buf.readUInt32LE(16);
    console.log(`${name}: initSize=${objInitSize}, codeSize=${objCodeSize}, globalAlloc=${globalAlloc}`);
}

if (result.tpc) {
    console.log('\n=== Linked TPC ===');
    const descStart = 48;
    const codeOff = result.tpc.readUInt32LE(descStart);
    const codeSize = result.tpc.readUInt32LE(descStart + 4);
    const initOff = result.tpc.readUInt32LE(descStart + 8);
    const initSize = result.tpc.readUInt32LE(descStart + 12);
    console.log(`codeOff=${codeOff}, codeSize=${codeSize}`);
    console.log(`initOff=${initOff}, initSize=${initSize}`);
    console.log(`globalAlloc=${result.tpc.readUInt32LE(16)}, platformSize=${result.tpc.readUInt32LE(12)}, stackSize=${result.tpc.readUInt32LE(20)}`);

    const codeData = result.tpc.slice(codeOff, codeOff + Math.min(codeSize, 1000));
    const retPositions: number[] = [];
    for (let i = 0; i < codeData.length; i++) {
        if (codeData[i] === 0x1F) retPositions.push(i);
    }
    console.log(`First 0x1F (RET) positions in code (first 1000 bytes): ${retPositions.join(', ')}`);
    console.log(`Init block (before first RET): ${codeData.slice(0, retPositions[0] || 0).toString('hex')}`);

    for (const refName of ['tmp1', 'tmp2']) {
        const refTpcPath = path.join(projectPath, refName, 'MyDeviceTestHello___1.0.0.tpc');
        if (!fs.existsSync(refTpcPath)) continue;
        const refTpc = fs.readFileSync(refTpcPath);
        const refCodeOff = refTpc.readUInt32LE(descStart);
        const refCodeSize = refTpc.readUInt32LE(descStart + 4);
        const refInitOff = refTpc.readUInt32LE(descStart + 8);
        const refInitSize = refTpc.readUInt32LE(descStart + 12);
        console.log(`\nRef TPC (${refName}/): codeOff=${refCodeOff}, codeSize=${refCodeSize}`);
        console.log(`  initOff=${refInitOff}, initSize=${refInitSize}`);
        console.log(`  globalAlloc=${refTpc.readUInt32LE(16)}, platformSize=${refTpc.readUInt32LE(12)}, stackSize=${refTpc.readUInt32LE(20)}`);

        const refCodeData = refTpc.slice(refCodeOff, refCodeOff + Math.min(refCodeSize, 1000));
        const refRetPositions: number[] = [];
        for (let i = 0; i < refCodeData.length; i++) {
            if (refCodeData[i] === 0x1F) refRetPositions.push(i);
        }
        console.log(`  First 0x1F positions: ${refRetPositions.join(', ')}`);
        console.log(`  Init block (${refRetPositions[0] || 0} bytes): ${refCodeData.slice(0, refRetPositions[0] || 0).toString('hex')}`);
    }
}
