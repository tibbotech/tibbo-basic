import TOBJ from '../TOBJ';
import { disassembleCodeBuffer, DecodedInstruction } from '../compiler/dump-pdb-instructions';
import { TOBJ_SECTION_DESCRIPTOR, TOBJScopeEntry, TOBJSourceFile } from '../types';

export interface DecodedCodeInstructionJson {
    /** Byte offset within the Code section */
    offset: number;
    size: number;
    mnemonic: string;
    bytesHex: string;
    fileName: string;
    line: number;
    column: number;
    /** {@code file:line:column} (1-based line/column as stored in the object file) */
    location: string;
}

interface FlatLineEntry {
    address: number;
    fileName: string;
    line: number;
}

function toHexByte(v: number): string {
    return v.toString(16).toUpperCase().padStart(2, '0');
}

function bytesToHex(bytes: number[]): string {
    return bytes.map(toHexByte).join(' ');
}

function buildFlatLineMap(sourceFiles: TOBJSourceFile[]): FlatLineEntry[] {
    const rows: FlatLineEntry[] = [];
    for (const sf of sourceFiles) {
        for (const li of sf.lines) {
            rows.push({ address: li.address, fileName: sf.fileName, line: li.line });
        }
    }
    rows.sort((a, b) => a.address - b.address);
    return rows;
}

/**
 * Largest line-table entry with {@code address <= pc} (standard line-to-PC mapping).
 */
function resolveLineAtPc(sorted: FlatLineEntry[], pc: number): Pick<FlatLineEntry, 'fileName' | 'line'> {
    let lo = 0;
    let hi = sorted.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].address <= pc) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (best < 0) {
        return { fileName: '', line: 0 };
    }
    const e = sorted[best];
    return { fileName: e.fileName, line: e.line };
}

/**
 * TOBJ line info has no column; use the innermost function scope that contains {@code pc}, if any.
 */
function columnFromScopes(scopes: TOBJScopeEntry[], pc: number): number {
    let bestSpan = Number.POSITIVE_INFINITY;
    let col = 0;
    for (const s of scopes) {
        const lo = s.begin.address;
        const hi = s.end.address;
        if (pc < lo || pc >= hi) {
            continue;
        }
        const span = hi - lo;
        if (span >= 0 && span < bestSpan) {
            bestSpan = span;
            col = s.begin.sourcePosition.column;
        }
    }
    return col;
}

function toJsonRow(
    ins: DecodedInstruction,
    fileName: string,
    line: number,
    column: number,
): DecodedCodeInstructionJson {
    const loc =
        fileName !== '' || line > 0 || column > 0
            ? `${fileName || '?'}:${line}:${column}`
            : `?:0:0`;
    return {
        offset: ins.address,
        size: ins.size,
        mnemonic: ins.mnemonic,
        bytesHex: bytesToHex(ins.bytes),
        fileName,
        line,
        column,
        location: loc,
    };
}

/**
 * Decode the Code section into VM opcodes and attach source from line info + scope begin columns.
 */
export function decodeCodeInstructionsForTobj(tobj: TOBJ): DecodedCodeInstructionJson[] {
    const desc = tobj.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_CODE];
    const code = desc?.buffer;
    if (!code || code.length === 0) {
        return [];
    }

    const instructions = disassembleCodeBuffer(code, tobj.flags);
    const lineMap = buildFlatLineMap(tobj.sourceFiles);
    const scopes = tobj.scopes;

    return instructions.map((ins) => {
        const { fileName, line } = resolveLineAtPc(lineMap, ins.address);
        const column = columnFromScopes(scopes, ins.address);
        return toJsonRow(ins, fileName, line, column);
    });
}
