import * as fs from 'fs';
import * as path from 'path';
import {
    HEADER_SIZE, SECTION_DESCRIPTOR_SIZE, TObjSection,
    TOBJ_SIGNATURE_OBJ, TOBJ_SIGNATURE_BIN, TObjHeaderFlags,
} from './src/compiler/tobj/format';
import { disassembleBinarySectionToLines } from './src/compiler/dump-pdb-instructions';

const SECTION_NAMES: Record<number, string> = {
    [TObjSection.Code]: 'Code',
    [TObjSection.Init]: 'Init',
    [TObjSection.RData]: 'RData',
    [TObjSection.FileData]: 'FileData',
    [TObjSection.Symbols]: 'Symbols',
    [TObjSection.ResFileDir]: 'ResFileDir',
    [TObjSection.EventDir]: 'EventDir',
    [TObjSection.LibFileDir]: 'LibFileDir',
    [TObjSection.Extra]: 'Extra',
    [TObjSection.Addresses]: 'Addresses',
    [TObjSection.Functions]: 'Functions',
    [TObjSection.Scopes]: 'Scopes',
    [TObjSection.Variables]: 'Variables',
    [TObjSection.Objects]: 'Objects',
    [TObjSection.Syscalls]: 'Syscalls',
    [TObjSection.Types]: 'Types',
    [TObjSection.RDataDir]: 'RDataDir',
    [TObjSection.LineInfo]: 'LineInfo',
    [TObjSection.LibNameDir]: 'LibNameDir',
    [TObjSection.IncNameDir]: 'IncNameDir',
};

function readSection(buf: Buffer, sectionIdx: number, sectionCount: number): { offset: number; size: number; data: Buffer } {
    if (sectionIdx >= sectionCount) return { offset: 0, size: 0, data: Buffer.alloc(0) };
    const descOff = HEADER_SIZE + sectionIdx * SECTION_DESCRIPTOR_SIZE;
    const offset = buf.readUInt32LE(descOff);
    const size = buf.readUInt32LE(descOff + 4);
    return { offset, size, data: buf.slice(offset, offset + size) };
}

function readSymString(symbols: Buffer, offset: number): string {
    if (offset < 0 || offset >= symbols.length) return '';
    let end = offset;
    while (end < symbols.length && symbols[end] !== 0) end++;
    return symbols.toString('utf8', offset, end);
}

function dumpAllSymbols(symbols: Buffer): string[] {
    const result: string[] = [];
    let pos = 0;
    let idx = 0;
    while (pos < symbols.length) {
        let end = pos;
        while (end < symbols.length && symbols[end] !== 0) end++;
        result.push(`  [${idx}] @${pos}: "${symbols.toString('utf8', pos, end)}"`);
        idx++;
        pos = end + 1;
    }
    return result;
}

function compareFiles(name: string, file1: string, file2: string): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`COMPARING: ${name}`);
    console.log(`${'='.repeat(80)}`);

    if (!fs.existsSync(file1)) { console.log(`  tmp1 file missing: ${file1}`); return; }
    if (!fs.existsSync(file2)) { console.log(`  tmp2 file missing: ${file2}`); return; }

    const buf1 = fs.readFileSync(file1);
    const buf2 = fs.readFileSync(file2);

    console.log(`  File sizes: tmp1=${buf1.length} tmp2=${buf2.length} diff=${buf1.length - buf2.length}`);

    const sig1 = buf1.readUInt32LE(0);
    const sig2 = buf2.readUInt32LE(0);
    const isBin = sig1 === TOBJ_SIGNATURE_BIN;
    const sectionCount = isBin ? TObjSection.CountBin : TObjSection.CountObj;

    const flags1 = buf1.readUInt32LE(28);
    const flags2 = buf2.readUInt32LE(28);
    console.log(`  Flags: tmp1=0x${flags1.toString(16)} tmp2=0x${flags2.toString(16)}`);

    console.log(`\n  Section sizes:`);
    console.log(`  ${'Section'.padEnd(15)} ${'tmp1'.padStart(8)} ${'tmp2'.padStart(8)} ${'diff'.padStart(8)}`);

    const differentSections: number[] = [];
    for (let i = 0; i < sectionCount; i++) {
        const s1 = readSection(buf1, i, sectionCount);
        const s2 = readSection(buf2, i, sectionCount);
        const sName = SECTION_NAMES[i] || `Section${i}`;
        const diff = s1.size - s2.size;
        const marker = diff !== 0 ? ' ***' : '';
        console.log(`  ${sName.padEnd(15)} ${String(s1.size).padStart(8)} ${String(s2.size).padStart(8)} ${String(diff).padStart(8)}${marker}`);
        if (diff !== 0) differentSections.push(i);
    }

    // Disassemble code sections
    for (const secIdx of [TObjSection.Code, TObjSection.Init]) {
        const s1 = readSection(buf1, secIdx, sectionCount);
        const s2 = readSection(buf2, secIdx, sectionCount);
        if (s1.size === 0 && s2.size === 0) continue;
        if (s1.size === s2.size && s1.data.equals(s2.data)) continue;

        const sName = SECTION_NAMES[secIdx];
        console.log(`\n  --- ${sName} section disassembly diff ---`);
        try {
            const lines1 = disassembleBinarySectionToLines(buf1, secIdx);
            const lines2 = disassembleBinarySectionToLines(buf2, secIdx);
            console.log(`  tmp1 instructions: ${lines1.length}`);
            console.log(`  tmp2 instructions: ${lines2.length}`);

            // Find first difference
            const maxLen = Math.max(lines1.length, lines2.length);
            let diffCount = 0;
            for (let i = 0; i < maxLen && diffCount < 20; i++) {
                const l1 = lines1[i] || '(missing)';
                const l2 = lines2[i] || '(missing)';
                if (l1 !== l2) {
                    if (diffCount === 0) console.log(`  First diff at instruction ${i}:`);
                    console.log(`    [${i}] tmp1: ${l1.trim()}`);
                    console.log(`    [${i}] tmp2: ${l2.trim()}`);
                    diffCount++;
                }
            }
            if (diffCount === 0) console.log(`  Code instructions match!`);
        } catch (e) {
            console.log(`  Error disassembling: ${(e as any).message}`);
        }
    }

    // Compare Addresses section
    if (differentSections.includes(TObjSection.Addresses)) {
        const s1 = readSection(buf1, TObjSection.Addresses, sectionCount);
        const s2 = readSection(buf2, TObjSection.Addresses, sectionCount);
        const sym1 = readSection(buf1, TObjSection.Symbols, sectionCount);
        const sym2 = readSection(buf2, TObjSection.Symbols, sectionCount);
        console.log(`\n  --- Addresses section comparison ---`);
        const addrs1 = parseAddresses(s1.data, sym1.data);
        const addrs2 = parseAddresses(s2.data, sym2.data);
        console.log(`  tmp1 address entries: ${addrs1.length}`);
        console.log(`  tmp2 address entries: ${addrs2.length}`);

        const names1 = new Set(addrs1.map(a => a.name));
        const names2 = new Set(addrs2.map(a => a.name));
        const missing = addrs1.filter(a => !names2.has(a.name));
        const extra = addrs2.filter(a => !names1.has(a.name));

        if (missing.length > 0) {
            console.log(`\n  Addresses in tmp1 but MISSING from tmp2 (${missing.length}):`);
            for (const a of missing.slice(0, 50)) {
                console.log(`    ${a.name} addr=${a.address} refs=${a.refCount} flags=0x${a.flags.toString(16)}`);
            }
            if (missing.length > 50) console.log(`    ... and ${missing.length - 50} more`);
        }
        if (extra.length > 0) {
            console.log(`\n  Addresses in tmp2 but NOT in tmp1 (${extra.length}):`);
            for (const a of extra.slice(0, 30)) {
                console.log(`    ${a.name} addr=${a.address} refs=${a.refCount} flags=0x${a.flags.toString(16)}`);
            }
        }
    }

    // Compare Functions section
    if (differentSections.includes(TObjSection.Functions)) {
        const s1 = readSection(buf1, TObjSection.Functions, sectionCount);
        const s2 = readSection(buf2, TObjSection.Functions, sectionCount);
        const sym1 = readSection(buf1, TObjSection.Symbols, sectionCount);
        const sym2 = readSection(buf2, TObjSection.Symbols, sectionCount);
        console.log(`\n  --- Functions section comparison ---`);
        const fns1 = parseFunctions(s1.data, sym1.data);
        const fns2 = parseFunctions(s2.data, sym2.data);
        console.log(`  tmp1 functions: ${fns1.length}`);
        console.log(`  tmp2 functions: ${fns2.length}`);

        const fNames1 = new Set(fns1.map(f => f.name));
        const fNames2 = new Set(fns2.map(f => f.name));
        const missingFns = fns1.filter(f => !fNames2.has(f.name));
        const extraFns = fns2.filter(f => !fNames1.has(f.name));

        if (missingFns.length > 0) {
            console.log(`  Functions in tmp1 but MISSING from tmp2 (${missingFns.length}):`);
            for (const f of missingFns.slice(0, 30)) {
                console.log(`    ${f.name}`);
            }
        }
        if (extraFns.length > 0) {
            console.log(`  Functions in tmp2 but NOT in tmp1 (${extraFns.length}):`);
            for (const f of extraFns.slice(0, 30)) {
                console.log(`    ${f.name}`);
            }
        }
    }

    // Compare Symbols section
    if (differentSections.includes(TObjSection.Symbols)) {
        const sym1 = readSection(buf1, TObjSection.Symbols, sectionCount);
        const sym2 = readSection(buf2, TObjSection.Symbols, sectionCount);
        console.log(`\n  --- Symbols section comparison ---`);
        const strs1 = extractAllStrings(sym1.data);
        const strs2 = extractAllStrings(sym2.data);
        console.log(`  tmp1 symbol strings: ${strs1.length}`);
        console.log(`  tmp2 symbol strings: ${strs2.length}`);

        const set1 = new Set(strs1);
        const set2 = new Set(strs2);
        const missingSyms = strs1.filter(s => !set2.has(s));
        const extraSyms = strs2.filter(s => !set1.has(s));

        if (missingSyms.length > 0) {
            console.log(`  Symbols in tmp1 but MISSING from tmp2 (${missingSyms.length}):`);
            for (const s of missingSyms.slice(0, 40)) {
                console.log(`    "${s}"`);
            }
            if (missingSyms.length > 40) console.log(`    ... and ${missingSyms.length - 40} more`);
        }
        if (extraSyms.length > 0) {
            console.log(`  Symbols in tmp2 but NOT in tmp1 (${extraSyms.length}):`);
            for (const s of extraSyms.slice(0, 20)) {
                console.log(`    "${s}"`);
            }
        }
    }

    // Compare Variables section
    if (differentSections.includes(TObjSection.Variables)) {
        const s1 = readSection(buf1, TObjSection.Variables, sectionCount);
        const s2 = readSection(buf2, TObjSection.Variables, sectionCount);
        console.log(`\n  --- Variables section size diff: tmp1=${s1.size} tmp2=${s2.size} ---`);
    }

    // Compare Scopes section
    if (differentSections.includes(TObjSection.Scopes)) {
        const s1 = readSection(buf1, TObjSection.Scopes, sectionCount);
        const s2 = readSection(buf2, TObjSection.Scopes, sectionCount);
        console.log(`\n  --- Scopes section size diff: tmp1=${s1.size} tmp2=${s2.size} ---`);
        const scopeEntrySize = 32;
        console.log(`  tmp1 scope entries: ${s1.size / scopeEntrySize}`);
        console.log(`  tmp2 scope entries: ${s2.size / scopeEntrySize}`);
    }
}

interface AddressEntry {
    flags: number;
    name: string;
    address: number;
    refCount: number;
}

function parseAddresses(data: Buffer, symbols: Buffer): AddressEntry[] {
    const entries: AddressEntry[] = [];
    let pos = 0;
    while (pos < data.length) {
        if (pos + 17 > data.length) break;
        const flags = data[pos]; pos++;
        const nameOff = data.readUInt32LE(pos); pos += 4;
        const address = data.readUInt32LE(pos); pos += 4;
        pos += 4; // skip segment
        const refCount = data.readUInt32LE(pos); pos += 4;
        pos += refCount * 5; // skip references (1 byte type + 4 byte offset)

        entries.push({
            flags,
            name: readSymString(symbols, nameOff),
            address,
            refCount,
        });
    }
    return entries;
}

interface FunctionEntry {
    flags: number;
    name: string;
    addrIdx: number;
    eventNum: number;
}

function parseFunctions(data: Buffer, symbols: Buffer): FunctionEntry[] {
    const entries: FunctionEntry[] = [];
    let pos = 0;
    while (pos < data.length) {
        if (pos + 17 > data.length) break;
        const flags = data[pos]; pos++;
        const nameOff = data.readUInt32LE(pos); pos += 4;
        const addrIdx = data.readUInt32LE(pos); pos += 4;
        const eventNum = data.readUInt32LE(pos); pos += 4;
        const calleeCount = data.readUInt32LE(pos); pos += 4;
        pos += calleeCount * 4;

        entries.push({
            flags,
            name: readSymString(symbols, nameOff),
            addrIdx,
            eventNum,
        });
    }
    return entries;
}

function extractAllStrings(data: Buffer): string[] {
    const result: string[] = [];
    let pos = 0;
    while (pos < data.length) {
        let end = pos;
        while (end < data.length && data[end] !== 0) end++;
        if (end > pos) result.push(data.toString('utf8', pos, end));
        pos = end + 1;
    }
    return result;
}

const dir1 = path.resolve(__dirname, '../tests/MyDeviceTestHello/tmp1');
const dir2 = path.resolve(__dirname, '../tests/MyDeviceTestHello/tmp2');

const files1 = fs.readdirSync(dir1).filter(f => f.endsWith('.obj') || f.endsWith('.tpc'));
const files2 = fs.readdirSync(dir2).filter(f => f.endsWith('.obj') || f.endsWith('.tpc'));

const allFiles = new Set([...files1, ...files2]);

console.log('Comparing tmp1 (correct/reference) vs tmp2 (JS compiler output)');
console.log(`tmp1 files: ${files1.join(', ')}`);
console.log(`tmp2 files: ${files2.join(', ')}`);

// Summary table
console.log(`\n${'File'.padEnd(25)} ${'tmp1'.padStart(8)} ${'tmp2'.padStart(8)} ${'diff'.padStart(8)} ${'%'.padStart(6)}`);
for (const f of allFiles) {
    const p1 = path.join(dir1, f);
    const p2 = path.join(dir2, f);
    const s1 = fs.existsSync(p1) ? fs.statSync(p1).size : 0;
    const s2 = fs.existsSync(p2) ? fs.statSync(p2).size : 0;
    const diff = s1 - s2;
    const pct = s1 > 0 ? ((s2 / s1) * 100).toFixed(1) : 'N/A';
    console.log(`${f.padEnd(25)} ${String(s1).padStart(8)} ${String(s2).padStart(8)} ${String(diff).padStart(8)} ${String(pct).padStart(6)}%`);
}

for (const f of allFiles) {
    compareFiles(f, path.join(dir1, f), path.join(dir2, f));
}
