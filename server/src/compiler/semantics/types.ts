export enum PrimitiveType {
    Boolean = 'boolean',
    Char = 'char',
    Byte = 'byte',
    Short = 'short',
    Word = 'word',
    Integer = 'integer',
    Long = 'long',
    Dword = 'dword',
    Real = 'real',
    Float = 'float',
    String = 'string',
}

export interface DataType {
    kind: string;
    name: string;
    size: number;
    signed: boolean;
}

export interface PrimitiveDataType extends DataType {
    kind: 'primitive';
    primitiveType: PrimitiveType;
}

export interface StringDataType extends DataType {
    kind: 'string';
    maxLength: number;
}

export interface ArrayDataType extends DataType {
    kind: 'array';
    elementType: DataType;
    elementCount: number;
    dimensions: number[];
}

export interface StructMember {
    name: string;
    index: number;
    offset: number;
    dataType: DataType;
}

export interface StructDataType extends DataType {
    kind: 'struct';
    members: StructMember[];
    memberMap: Map<string, StructMember>;
}

export interface EnumMember {
    name: string;
    value: bigint;
}

export interface EnumDataType extends DataType {
    kind: 'enum';
    actualType: DataType;
    members: EnumMember[];
    memberMap: Map<string, EnumMember>;
}

export interface PointerDataType extends DataType {
    kind: 'pointer';
    targetType: DataType;
}

export const BUILTIN_TYPES: Record<string, PrimitiveDataType> = {
    boolean: { kind: 'primitive', name: 'boolean', primitiveType: PrimitiveType.Boolean, size: 1, signed: false },
    char:    { kind: 'primitive', name: 'char',    primitiveType: PrimitiveType.Char,    size: 1, signed: true },
    byte:    { kind: 'primitive', name: 'byte',    primitiveType: PrimitiveType.Byte,    size: 1, signed: false },
    short:   { kind: 'primitive', name: 'short',   primitiveType: PrimitiveType.Short,   size: 2, signed: true },
    word:    { kind: 'primitive', name: 'word',    primitiveType: PrimitiveType.Word,     size: 2, signed: false },
    integer: { kind: 'primitive', name: 'integer', primitiveType: PrimitiveType.Integer, size: 2, signed: true },
    long:    { kind: 'primitive', name: 'long',    primitiveType: PrimitiveType.Long,     size: 4, signed: true },
    dword:   { kind: 'primitive', name: 'dword',   primitiveType: PrimitiveType.Dword,   size: 4, signed: false },
    real:    { kind: 'primitive', name: 'real',    primitiveType: PrimitiveType.Real,     size: 4, signed: true },
    float:   { kind: 'primitive', name: 'float',   primitiveType: PrimitiveType.Float,   size: 4, signed: true },
};

export function makeStringType(maxLength: number): StringDataType {
    return {
        kind: 'string',
        name: `string(${maxLength})`,
        size: maxLength + 2,
        signed: false,
        maxLength,
    };
}

export function makeArrayType(elementType: DataType, dimensions: number[]): ArrayDataType {
    const elementCount = dimensions.reduce((a, b) => a * b, 1);
    return {
        kind: 'array',
        name: `${elementType.name}[]`,
        size: elementType.size * elementCount,
        signed: false,
        elementType,
        elementCount,
        dimensions,
    };
}

export function makeStructType(name: string, members: StructMember[]): StructDataType {
    let totalSize = 0;
    const memberMap = new Map<string, StructMember>();
    for (const m of members) {
        memberMap.set(m.name.toLowerCase(), m);
        const end = m.offset + m.dataType.size;
        if (end > totalSize) totalSize = end;
    }
    return {
        kind: 'struct',
        name,
        size: totalSize,
        signed: false,
        members,
        memberMap,
    };
}

export function makeEnumType(name: string, members: EnumMember[]): EnumDataType {
    const memberMap = new Map<string, EnumMember>();
    let minVal = BigInt(0);
    let maxVal = BigInt(0);
    for (const m of members) {
        memberMap.set(m.name.toLowerCase(), m);
        if (m.value < minVal) minVal = m.value;
        if (m.value > maxVal) maxVal = m.value;
    }

    let actualType: DataType;
    if (minVal >= BigInt(-128) && maxVal <= BigInt(127)) {
        actualType = BUILTIN_TYPES.char;
    } else if (minVal >= BigInt(0) && maxVal <= BigInt(0xFF)) {
        actualType = BUILTIN_TYPES.byte;
    } else if (minVal >= BigInt(-32768) && maxVal <= BigInt(32767)) {
        actualType = BUILTIN_TYPES.short;
    } else if (minVal >= BigInt(0) && maxVal <= BigInt(0xFFFF)) {
        actualType = BUILTIN_TYPES.word;
    } else if (minVal >= BigInt(-2147483648) && maxVal <= BigInt(2147483647)) {
        actualType = BUILTIN_TYPES.long;
    } else {
        actualType = BUILTIN_TYPES.dword;
    }

    return {
        kind: 'enum',
        name,
        size: actualType.size,
        signed: actualType.signed,
        actualType,
        members,
        memberMap,
    };
}

export function isPrimitive(t: DataType): t is PrimitiveDataType {
    return t.kind === 'primitive';
}

export function isString(t: DataType): t is StringDataType {
    return t.kind === 'string';
}

export function isArray(t: DataType): t is ArrayDataType {
    return t.kind === 'array';
}

export function isStruct(t: DataType): t is StructDataType {
    return t.kind === 'struct';
}

export function isEnum(t: DataType): t is EnumDataType {
    return t.kind === 'enum';
}

export function isNumeric(t: DataType): boolean {
    if (isPrimitive(t)) {
        return t.primitiveType !== PrimitiveType.String;
    }
    if (isEnum(t)) return true;
    return false;
}

export function isIntegral(t: DataType): boolean {
    if (isPrimitive(t)) {
        return t.primitiveType !== PrimitiveType.String
            && t.primitiveType !== PrimitiveType.Real
            && t.primitiveType !== PrimitiveType.Float;
    }
    if (isEnum(t)) return true;
    return false;
}

export function isFloat(t: DataType): boolean {
    return isPrimitive(t) && (t.primitiveType === PrimitiveType.Real || t.primitiveType === PrimitiveType.Float);
}

export function getPromotedType(a: DataType, b: DataType): DataType {
    if (isFloat(a) || isFloat(b)) return BUILTIN_TYPES.real;

    const sizeA = a.size;
    const sizeB = b.size;
    const maxSize = Math.max(sizeA, sizeB);

    if (a.signed || b.signed) {
        if (maxSize >= 4) return BUILTIN_TYPES.long;
        if (maxSize >= 2) return BUILTIN_TYPES.short;
        return BUILTIN_TYPES.char;
    }

    if (maxSize >= 4) return BUILTIN_TYPES.dword;
    if (maxSize >= 2) return BUILTIN_TYPES.word;
    return BUILTIN_TYPES.byte;
}

export function typesCompatible(target: DataType, source: DataType): boolean {
    if (target.kind === source.kind && target.name === source.name) return true;
    if (isNumeric(target) && isNumeric(source)) return true;
    if (isString(target) && isString(source)) return true;
    if (isEnum(target) && isIntegral(source)) return true;
    if (isIntegral(target) && isEnum(source)) return true;
    return false;
}
