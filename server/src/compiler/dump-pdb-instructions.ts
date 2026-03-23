#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import {
    HEADER_SIZE,
    SECTION_DESCRIPTOR_SIZE,
    TObjHeaderFlags,
    TObjSection,
    TOBJ_SIGNATURE_BIN,
    TOBJ_SIGNATURE_OBJ,
    TOBJ_SIGNATURE_PDB,
    TOBJ_SIGNATURE_PDB_ALT_TPDB,
    TOBJ_SIGNATURE_PDB_ALT_TDBP,
} from './tobj/format';
import * as OP from './codegen/opcodes';

interface SectionDescriptor {
    offset: number;
    size: number;
}

interface ParsedHeader {
    signature: number;
    flags: number;
    sectionCount: number;
    sections: SectionDescriptor[];
}

interface LineInfoEntry {
    line: number;
    address: number;
}

interface LineInfoFile {
    fileName: string;
    lines: LineInfoEntry[];
}

interface DecodedInstruction {
    address: number;
    size: number;
    mnemonic: string;
    bytes: number[];
}

export interface DecodedLineInstruction {
    fileName: string;
    line: number;
    instruction: string;
}

const DIRECT_PREFIX = 0x00;
const INDIRECT_PREFIX = 0x40;
const IMMEDIATE_PREFIX = 0x80;
const OPCODE_PREFIX_MASK = 0xC0;
const OPCODE_BASE_MASK = 0x3F;

const SINGLE_BYTE_MNEMONICS = new Map<number, string>([
    [OP.OPCODE_CMP, 'CMP'],
    [OP.OPCODE_NEG, 'NEG'],
    [OP.OPCODE_NOT, 'NOT'],
    [OP.OPCODE_AND, 'AND'],
    [OP.OPCODE_OR, 'OR'],
    [OP.OPCODE_XOR, 'XOR'],
    [OP.OPCODE_ADD, 'ADD'],
    [OP.OPCODE_SUB, 'SUB'],
    [OP.OPCODE_MUL, 'MUL'],
    [OP.OPCODE_DIV, 'DIV'],
    [OP.OPCODE_DIVI, 'DIVI'],
    [OP.OPCODE_MOD, 'MOD'],
    [OP.OPCODE_MODI, 'MODI'],
    [OP.OPCODE_SHL, 'SHL'],
    [OP.OPCODE_SHR, 'SHR'],
    [OP.OPCODE_RET, 'RET'],
    [OP.OPCODE_HALT, 'HALT'],
    [OP.OPCODE_XCG, 'XCG'],
]);

const BASE_MNEMONICS = new Map<number, string>([
    [OP.OPCODE_LOA8, 'LOA8'],
    [OP.OPCODE_LOA8I, 'LOA8I'],
    [OP.OPCODE_LOA16, 'LOA16'],
    [OP.OPCODE_LOB8, 'LOB8'],
    [OP.OPCODE_LOB8I, 'LOB8I'],
    [OP.OPCODE_LOB16, 'LOB16'],
    [OP.OPCODE_STO8, 'STO8'],
    [OP.OPCODE_STO16, 'STO16'],
    [OP.OPCODE_CALL, 'CALL'],
    [OP.OPCODE_JMP, 'JMP'],
    [OP.OPCODE_JE, 'JE'],
    [OP.OPCODE_JNE, 'JNE'],
    [OP.OPCODE_JG, 'JG'],
    [OP.OPCODE_JGE, 'JGE'],
    [OP.OPCODE_JA, 'JA'],
    [OP.OPCODE_JAE, 'JAE'],
    [OP.OPCODE_JL, 'JL'],
    [OP.OPCODE_JLE, 'JLE'],
    [OP.OPCODE_JB, 'JB'],
    [OP.OPCODE_JBE, 'JBE'],
    [OP.OPCODE_SYSCALL, 'SYSCALL'],
    [OP.OPCODE_LEA, 'LEA'],
    [OP.OPCODE_SYSCALL2, 'SYSCALL2'],
    [OP.OPCODE_LOABF, 'LOABF'],
    [OP.OPCODE_LOABFI, 'LOABFI'],
    [OP.OPCODE_LOBBF, 'LOBBF'],
    [OP.OPCODE_LOBBFI, 'LOBBFI'],
    [OP.OPCODE_MRGBF, 'MRGBF'],
    [OP.OPCODE_LOAB32, 'LOAB32'],
    [OP.OPCODE_STOAB32, 'STOAB32'],
    [OP.OPCODE_EXT32I, 'EXT32I'],
    [OP.OPCODE_LOA16I, 'LOA16I'],
    [OP.OPCODE_LOB16I, 'LOB16I'],
    [OP.OPCODE_LOA32, 'LOA32'],
    [OP.OPCODE_LOB32, 'LOB32'],
    [OP.OPCODE_STO32, 'STO32'],
]);

function printUsage(): void {
    console.log(`Usage: dump-pdb-instructions <path-to-file.pdb|.obj|.tpc> [--all]

Decodes the Code section and prints instructions grouped by source line from PDB/OBJ line info.

Options:
  --all        Print full instruction stream (address + instruction)
  -h, --help   Show this help
`);
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    const showAll = args.includes('--all');
    const inputArg = args.find(a => !a.startsWith('-'));
    if (!inputArg) {
        console.error('Error: input file path is required.');
        printUsage();
        process.exit(1);
    }

    const inputPath = path.resolve(inputArg);
    if (!fs.existsSync(inputPath)) {
        console.error(`Error: file does not exist: ${inputPath}`);
        process.exit(1);
    }

    const buf = fs.readFileSync(inputPath);
    const header = parseHeader(buf);
    const code = getSectionBuffer(buf, header, TObjSection.Code);
    const symbols = getSectionBuffer(buf, header, TObjSection.Symbols);
    const lineInfo = getSectionBuffer(buf, header, TObjSection.LineInfo);

    if (code.length === 0) {
        console.error('Error: Code section is empty or missing.');
        process.exit(1);
    }

    const useCode24 = (header.flags & TObjHeaderFlags.Code24) !== 0;
    const useData32 = (header.flags & TObjHeaderFlags.Data32) !== 0;
    const codeAddrSize = useCode24 ? 3 : 2;
    const dataAddrSize = useData32 ? 4 : 2;

    const instructions = disassemble(code, codeAddrSize, dataAddrSize);
    const files = parseLineInfo(lineInfo, symbols);

    if (showAll || files.length === 0) {
        printAll(instructions);
        return;
    }

    printGroupedByLine(instructions, files);
}

export function disassembleBinary(buf: Buffer): DecodedInstruction[] {
    const header = parseHeader(buf);
    const code = getSectionBuffer(buf, header, TObjSection.Code);
    if (code.length === 0) {
        return [];
    }
    const useCode24 = (header.flags & TObjHeaderFlags.Code24) !== 0;
    const useData32 = (header.flags & TObjHeaderFlags.Data32) !== 0;
    const codeAddrSize = useCode24 ? 3 : 2;
    const dataAddrSize = useData32 ? 4 : 2;
    return disassemble(code, codeAddrSize, dataAddrSize);
}

/**
 * Disassemble a single object section (e.g. Code or Init) using the file header flags.
 * For TBIN/PDB (BDPT)/TOBJ, bytecode lives in {@link TObjSection.Code} and {@link TObjSection.Init}.
 */
export function disassembleBinarySectionToLines(buf: Buffer, sectionIndex: TObjSection): string[] {
    const header = parseHeader(buf);
    const sectionBuf = getSectionBuffer(buf, header, sectionIndex);
    if (sectionBuf.length === 0) {
        return [];
    }
    const useCode24 = (header.flags & TObjHeaderFlags.Code24) !== 0;
    const useData32 = (header.flags & TObjHeaderFlags.Data32) !== 0;
    const codeAddrSize = useCode24 ? 3 : 2;
    const dataAddrSize = useData32 ? 4 : 2;
    return disassemble(sectionBuf, codeAddrSize, dataAddrSize).map(
        ins => `${ins.mnemonic} ${toHexBytes(ins.bytes)} `,
    );
}

export function disassembleBinaryToLines(buf: Buffer): string[] {
    return disassembleBinarySectionToLines(buf, TObjSection.Code);
}

export function disassembleBinaryBySourceLine(buf: Buffer): DecodedLineInstruction[] {
    const header = parseHeader(buf);
    const code = getSectionBuffer(buf, header, TObjSection.Code);
    const symbols = getSectionBuffer(buf, header, TObjSection.Symbols);
    const lineInfo = getSectionBuffer(buf, header, TObjSection.LineInfo);
    if (code.length === 0) {
        return [];
    }
    const useCode24 = (header.flags & TObjHeaderFlags.Code24) !== 0;
    const useData32 = (header.flags & TObjHeaderFlags.Data32) !== 0;
    const instructions = disassemble(code, useCode24 ? 3 : 2, useData32 ? 4 : 2);
    const files = parseLineInfo(lineInfo, symbols);

    const out: DecodedLineInstruction[] = [];
    for (const file of files) {
        const sortedLines = [...file.lines].sort((a, b) => a.address - b.address);
        let insIdx = 0;
        for (let i = 0; i < sortedLines.length; i++) {
            const cur = sortedLines[i];
            const nextStart = i + 1 < sortedLines.length ? sortedLines[i + 1].address : Number.MAX_SAFE_INTEGER;
            while (insIdx < instructions.length && instructions[insIdx].address < cur.address) {
                insIdx++;
            }
            while (insIdx < instructions.length && instructions[insIdx].address < nextStart) {
                const ins = instructions[insIdx];
                out.push({
                    fileName: file.fileName,
                    line: cur.line,
                    instruction: `${ins.mnemonic} ${toHexBytes(ins.bytes)} `,
                });
                insIdx++;
            }
        }
    }
    return out;
}

function parseHeader(buf: Buffer): ParsedHeader {
    if (buf.length < HEADER_SIZE) {
        throw new Error(`File is too small: ${buf.length} bytes`);
    }
    const signature = buf.readUInt32LE(0);
    if (
        signature !== TOBJ_SIGNATURE_OBJ &&
        signature !== TOBJ_SIGNATURE_PDB &&
        signature !== TOBJ_SIGNATURE_PDB_ALT_TPDB &&
        signature !== TOBJ_SIGNATURE_PDB_ALT_TDBP &&
        signature !== TOBJ_SIGNATURE_BIN
    ) {
        throw new Error(`Unsupported signature: 0x${signature.toString(16)}`);
    }

    const sectionCount = signature === TOBJ_SIGNATURE_BIN ? TObjSection.CountBin : TObjSection.CountObj;
    const flags = buf.readUInt32LE(28);
    const sections: SectionDescriptor[] = [];
    const descriptorStart = HEADER_SIZE;

    for (let i = 0; i < sectionCount; i++) {
        const off = descriptorStart + i * SECTION_DESCRIPTOR_SIZE;
        const offset = safeReadU32(buf, off);
        const size = safeReadU32(buf, off + 4);
        sections.push({ offset, size });
    }

    return { signature, flags, sectionCount, sections };
}

function safeReadU32(buf: Buffer, offset: number): number {
    if (offset < 0 || offset + 4 > buf.length) {
        return 0;
    }
    return buf.readUInt32LE(offset);
}

function getSectionBuffer(buf: Buffer, header: ParsedHeader, sectionIndex: number): Buffer {
    if (sectionIndex < 0 || sectionIndex >= header.sections.length) {
        return Buffer.alloc(0);
    }
    const desc = header.sections[sectionIndex];
    if (desc.size === 0) {
        return Buffer.alloc(0);
    }
    const end = desc.offset + desc.size;
    if (desc.offset < 0 || end > buf.length || desc.offset >= end) {
        return Buffer.alloc(0);
    }
    return buf.slice(desc.offset, end);
}

function parseLineInfo(lineInfo: Buffer, symbols: Buffer): LineInfoFile[] {
    const files: LineInfoFile[] = [];
    let pos = 0;

    while (pos + 8 <= lineInfo.length) {
        const fileNameOffset = lineInfo.readUInt32LE(pos);
        pos += 4;
        const lineCount = lineInfo.readUInt32LE(pos);
        pos += 4;

        const entries: LineInfoEntry[] = [];
        for (let i = 0; i < lineCount; i++) {
            if (pos + 8 > lineInfo.length) break;
            const line = lineInfo.readUInt32LE(pos);
            const address = lineInfo.readUInt32LE(pos + 4);
            pos += 8;
            entries.push({ line, address });
        }

        files.push({
            fileName: readSymString(symbols, fileNameOffset) || `<sym@${fileNameOffset}>`,
            lines: entries,
        });
    }

    return files.filter(f => f.lines.length > 0);
}

function readSymString(symbols: Buffer, offset: number): string {
    if (offset < 0 || offset >= symbols.length) {
        return '';
    }
    let end = offset;
    while (end < symbols.length && symbols[end] !== 0) {
        end++;
    }
    return symbols.toString('utf8', offset, end);
}

function disassemble(code: Buffer, codeAddrSize: number, dataAddrSize: number): DecodedInstruction[] {
    const out: DecodedInstruction[] = [];
    let pc = 0;

    while (pc < code.length) {
        const ins = decodeInstruction(code, pc, codeAddrSize, dataAddrSize);
        out.push(ins);
        pc += Math.max(1, ins.size);
    }

    return out;
}

function decodeInstruction(code: Buffer, pc: number, codeAddrSize: number, dataAddrSize: number): DecodedInstruction {
    const opcode = code[pc];
    const singleMnemonic = SINGLE_BYTE_MNEMONICS.get(opcode);
    if (singleMnemonic) {
        return {
            address: pc,
            size: 1,
            mnemonic: singleMnemonic,
            bytes: [opcode],
        };
    }

    const mode = opcode & OPCODE_PREFIX_MASK;
    const base = opcode & OPCODE_BASE_MASK;
    let mnemonic = BASE_MNEMONICS.get(base) || `OP_${toHexByte(opcode)}`;

    const usesPrefix = BASE_MNEMONICS.has(base);
    if (usesPrefix && mode === INDIRECT_PREFIX) {
        mnemonic += '_IND';
    } else if (usesPrefix && mode === IMMEDIATE_PREFIX) {
        mnemonic += '_IMM';
    }

    const operandSize = getOperandSize(base, mode, codeAddrSize, dataAddrSize);
    const totalSize = 1 + Math.min(operandSize, Math.max(0, code.length - (pc + 1)));
    const bytes = Array.from(code.slice(pc, pc + totalSize));

    return {
        address: pc,
        size: totalSize,
        mnemonic,
        bytes,
    };
}

function getOperandSize(base: number, mode: number, codeAddrSize: number, dataAddrSize: number): number {
    if (base === OP.OPCODE_SYSCALL) return 1;
    if (base === OP.OPCODE_SYSCALL2) return 2;

    if (
        base === OP.OPCODE_CALL ||
        base === OP.OPCODE_JMP ||
        base === OP.OPCODE_JE ||
        base === OP.OPCODE_JNE ||
        base === OP.OPCODE_JG ||
        base === OP.OPCODE_JGE ||
        base === OP.OPCODE_JA ||
        base === OP.OPCODE_JAE ||
        base === OP.OPCODE_JL ||
        base === OP.OPCODE_JLE ||
        base === OP.OPCODE_JB ||
        base === OP.OPCODE_JBE
    ) {
        return codeAddrSize;
    }

    if (mode === IMMEDIATE_PREFIX) {
        if (base === OP.OPCODE_LOA8 || base === OP.OPCODE_LOA8I || base === OP.OPCODE_LOB8 || base === OP.OPCODE_LOB8I) {
            return 1;
        }
        if (
            base === OP.OPCODE_LOA16 ||
            base === OP.OPCODE_LOA16I ||
            base === OP.OPCODE_LOB16 ||
            base === OP.OPCODE_LOB16I
        ) {
            return 2;
        }
        if (
            base === OP.OPCODE_LOA32 ||
            base === OP.OPCODE_LOB32 ||
            base === OP.OPCODE_LOAB32 ||
            base === OP.OPCODE_STO32 ||
            base === OP.OPCODE_STOAB32
        ) {
            return 4;
        }
        // Fallback for unknown immediate variants.
        return 2;
    }

    if (
        base === OP.OPCODE_LOA8 ||
        base === OP.OPCODE_LOA8I ||
        base === OP.OPCODE_LOA16 ||
        base === OP.OPCODE_LOA16I ||
        base === OP.OPCODE_LOA32 ||
        base === OP.OPCODE_LOB8 ||
        base === OP.OPCODE_LOB8I ||
        base === OP.OPCODE_LOB16 ||
        base === OP.OPCODE_LOB16I ||
        base === OP.OPCODE_LOB32 ||
        base === OP.OPCODE_STO8 ||
        base === OP.OPCODE_STO16 ||
        base === OP.OPCODE_STO32 ||
        base === OP.OPCODE_LEA ||
        base === OP.OPCODE_LOABF ||
        base === OP.OPCODE_LOABFI ||
        base === OP.OPCODE_LOBBF ||
        base === OP.OPCODE_LOBBFI ||
        base === OP.OPCODE_MRGBF ||
        base === OP.OPCODE_LOAB32 ||
        base === OP.OPCODE_STOAB32
    ) {
        return dataAddrSize;
    }

    return 0;
}

function printAll(instructions: DecodedInstruction[]): void {
    for (const ins of instructions) {
        console.log(`${toHexWord(ins.address)}: ${ins.mnemonic} ${toHexBytes(ins.bytes)} `);
    }
}

function printGroupedByLine(instructions: DecodedInstruction[], files: LineInfoFile[]): void {
    for (const file of files) {
        console.log(`# ${file.fileName}`);
        const sortedLines = [...file.lines].sort((a, b) => a.address - b.address);
        let insIdx = 0;

        for (let i = 0; i < sortedLines.length; i++) {
            const cur = sortedLines[i];
            const nextStart = i + 1 < sortedLines.length ? sortedLines[i + 1].address : Number.MAX_SAFE_INTEGER;
            console.log(`Line ${cur.line}:`);

            let emitted = 0;
            while (insIdx < instructions.length && instructions[insIdx].address < cur.address) {
                insIdx++;
            }
            while (insIdx < instructions.length && instructions[insIdx].address < nextStart) {
                const ins = instructions[insIdx];
                console.log(`  ${ins.mnemonic} ${toHexBytes(ins.bytes)} `);
                emitted++;
                insIdx++;
            }

            if (emitted === 0) {
                console.log('  (no instructions)');
            }
        }
        console.log('');
    }
}

function toHexWord(value: number): string {
    return value.toString(16).toUpperCase().padStart(4, '0');
}

function toHexByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
}

function toHexBytes(values: number[]): string {
    return values.map(v => toHexByte(v)).join(' ');
}

if (require.main === module) {
    main();
}
