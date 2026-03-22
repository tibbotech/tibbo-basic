import * as OP from './opcodes';
import { DataType, isFloat, isIntegral, isPrimitive, PrimitiveType } from '../semantics/types';

export interface BinaryOpInfo {
    opcodeWord: number;
    opcodeShort: number;
    syscallDword?: string;
    syscallLong?: string;
    syscallReal?: string;
    commutative: boolean;
}

export interface CmpOpInfo {
    trueJmp: number;
    falseJmp: number;
    invTrueJmp: number;
    invFalseJmp: number;
}

export interface UnaryOpInfo {
    opcodeWord: number;
    syscallDword?: string;
    syscallReal?: string;
}

// Arithmetic operator dispatch tables matching Operators.cpp
export const BINARY_OPS: Record<string, BinaryOpInfo> = {
    '+':   { opcodeWord: OP.OPCODE_ADD, opcodeShort: OP.OPCODE_ADD, syscallDword: '__add32',  syscallReal: '__fadd', commutative: true },
    '-':   { opcodeWord: OP.OPCODE_SUB, opcodeShort: OP.OPCODE_SUB, syscallDword: '__sub32',  syscallReal: '__fsub', commutative: false },
    '*':   { opcodeWord: OP.OPCODE_MUL, opcodeShort: OP.OPCODE_MUL, syscallDword: '__mul32',  syscallReal: '__fmul', commutative: true },
    '/':   { opcodeWord: OP.OPCODE_DIV, opcodeShort: OP.OPCODE_DIV, syscallDword: '__div32',  syscallLong: '__divi32', syscallReal: '__fdiv', commutative: false },
    'mod': { opcodeWord: OP.OPCODE_MOD, opcodeShort: OP.OPCODE_MOD, syscallDword: '__mod32',  syscallLong: '__modi32', commutative: false },
    'and': { opcodeWord: OP.OPCODE_AND, opcodeShort: OP.OPCODE_AND, syscallDword: '__and32',  commutative: true },
    'or':  { opcodeWord: OP.OPCODE_OR,  opcodeShort: OP.OPCODE_OR,  syscallDword: '__or32',   commutative: true },
    'xor': { opcodeWord: OP.OPCODE_XOR, opcodeShort: OP.OPCODE_XOR, syscallDword: '__xor32',  commutative: true },
    'shl': { opcodeWord: OP.OPCODE_SHL, opcodeShort: OP.OPCODE_SHL, syscallDword: '__shl32', commutative: false },
    'shr': { opcodeWord: OP.OPCODE_SHR, opcodeShort: OP.OPCODE_SHR, syscallDword: '__shr32', commutative: false },
};

// Comparison operator dispatch tables
export const CMP_OPS: Record<string, CmpOpInfo> = {
    '=':  { trueJmp: OP.OPCODE_JE,  falseJmp: OP.OPCODE_JNE, invTrueJmp: OP.OPCODE_JNE, invFalseJmp: OP.OPCODE_JE },
    '<>': { trueJmp: OP.OPCODE_JNE, falseJmp: OP.OPCODE_JE,  invTrueJmp: OP.OPCODE_JE,  invFalseJmp: OP.OPCODE_JNE },
};

export const CMP_OPS_SIGNED: Record<string, CmpOpInfo> = {
    '<':  { trueJmp: OP.OPCODE_JL,  falseJmp: OP.OPCODE_JGE, invTrueJmp: OP.OPCODE_JGE, invFalseJmp: OP.OPCODE_JL },
    '>':  { trueJmp: OP.OPCODE_JG,  falseJmp: OP.OPCODE_JLE, invTrueJmp: OP.OPCODE_JLE, invFalseJmp: OP.OPCODE_JG },
    '<=': { trueJmp: OP.OPCODE_JLE, falseJmp: OP.OPCODE_JG,  invTrueJmp: OP.OPCODE_JG,  invFalseJmp: OP.OPCODE_JLE },
    '>=': { trueJmp: OP.OPCODE_JGE, falseJmp: OP.OPCODE_JL,  invTrueJmp: OP.OPCODE_JL,  invFalseJmp: OP.OPCODE_JGE },
};

export const CMP_OPS_UNSIGNED: Record<string, CmpOpInfo> = {
    '<':  { trueJmp: OP.OPCODE_JB,  falseJmp: OP.OPCODE_JAE, invTrueJmp: OP.OPCODE_JAE, invFalseJmp: OP.OPCODE_JB },
    '>':  { trueJmp: OP.OPCODE_JA,  falseJmp: OP.OPCODE_JBE, invTrueJmp: OP.OPCODE_JBE, invFalseJmp: OP.OPCODE_JA },
    '<=': { trueJmp: OP.OPCODE_JBE, falseJmp: OP.OPCODE_JA,  invTrueJmp: OP.OPCODE_JA,  invFalseJmp: OP.OPCODE_JBE },
    '>=': { trueJmp: OP.OPCODE_JAE, falseJmp: OP.OPCODE_JB,  invTrueJmp: OP.OPCODE_JB,  invFalseJmp: OP.OPCODE_JAE },
};

export const UNARY_OPS: Record<string, UnaryOpInfo> = {
    '-':   { opcodeWord: OP.OPCODE_NEG, syscallDword: '__neg32', syscallReal: '__fneg' },
    'not': { opcodeWord: OP.OPCODE_NOT, syscallDword: '__not32' },
};

export function getLoadOpcode(type: DataType, register: 'A' | 'B'): number {
    const size = type.size;
    const signed = type.signed;

    if (register === 'A') {
        if (size >= 4) return OP.OPCODE_LOA32;
        if (size === 2) return signed ? OP.OPCODE_LOA16I : OP.OPCODE_LOA16;
        return signed ? OP.OPCODE_LOA8I : OP.OPCODE_LOA8;
    } else {
        if (size >= 4) return OP.OPCODE_LOB32;
        if (size === 2) return signed ? OP.OPCODE_LOB16I : OP.OPCODE_LOB16;
        return signed ? OP.OPCODE_LOB8I : OP.OPCODE_LOB8;
    }
}

export function getStoreOpcode(type: DataType): number {
    if (type.size >= 4) return OP.OPCODE_STO32;
    if (type.size === 2) return OP.OPCODE_STO16;
    return OP.OPCODE_STO8;
}

export function getCmpOpInfo(op: string, signed: boolean): CmpOpInfo | undefined {
    const eqOp = CMP_OPS[op];
    if (eqOp) return eqOp;
    return signed ? CMP_OPS_SIGNED[op] : CMP_OPS_UNSIGNED[op];
}

export function needsSyscall(type: DataType, op: string): boolean {
    return isFloat(type) || (isPrimitive(type) && type.size >= 4);
}

export function getSyscallName(type: DataType, op: string): string | undefined {
    const info = BINARY_OPS[op];
    if (!info) return undefined;
    if (isFloat(type)) return info.syscallReal;
    if (type.signed && info.syscallLong) return info.syscallLong;
    return info.syscallDword;
}
