// Tibbo Object File format constants -- matches tobjfmt.h

// File signatures (stored as LE uint32, so bytes appear as the ASCII string)
export const TOBJ_SIGNATURE_OBJ = 0x4A424F54;  // 'TOBJ' in file bytes
export const TOBJ_SIGNATURE_PDB = 0x50424454;  // 'TDBP' in file bytes
export const TOBJ_SIGNATURE_BIN = 0x4E494254;  // 'TBIN' in file bytes

export const TOBJ_VERSION = (3 | (5 << 8));    // version 3.5

// Section indices
export enum TObjSection {
    Code = 0,
    Init = 1,
    RData = 2,
    FileData = 3,
    Symbols = 4,
    ResFileDir = 5,
    EventDir = 6,
    LibFileDir = 7,
    Extra = 8,

    CountBin = 9,

    Addresses = 9,
    Functions = 10,
    Scopes = 11,
    Variables = 12,
    Objects = 13,
    Syscalls = 14,
    Types = 15,
    RDataDir = 16,
    LineInfo = 17,
    LibNameDir = 18,
    IncNameDir = 19,

    CountObj = 20,
}

// Header flags
export enum TObjHeaderFlags {
    Debug  = 0x01,
    Code24 = 0x02,
    Data32 = 0x04,
    Reg32  = 0x08,
}

// Address flags
export enum TObjAddressFlags {
    Defined = 1,
    Public  = 2,
    Code    = 4,
    Init    = 8,
}

// Function flags
export enum TObjFunctionFlags {
    Event    = 1,
    DoEvents = 2,
    Html     = 4,
    Static   = 8,
}

// Reference types
export enum TObjRefType {
    Code = 0,
    Init = 1,
    Html = 2,
}

// Data types
export enum TObjDataType {
    Unknown   = 0,
    Boolean   = 1,
    Byte      = 2,
    Char      = 3,
    Word      = 4,
    Short     = 5,
    Dword     = 6,
    Long      = 7,
    Real      = 8,
    String    = 9,
    Enum      = 10,
    Array     = 11,
    Struct    = 12,
    Void      = 13,
    Bitfield  = 14,
    Pointer   = 15,
    Reference = 16,
    ArrayC    = 17,
    StructC   = 18,
    Union     = 19,
    Function  = 20,
    Property  = 21,
}

// Variable flags
export enum TObjVariableFlags {
    Argument = 1,
    ByRef    = 2,
    Temp     = 4,
    Static   = 8,
}

// RTTI types
export enum TObjRttiType {
    Byte    = 0,
    Word    = 1,
    Dword   = 2,
    String  = 3,
    Array   = 4,
    Struct  = 5,
    Bitfield = 6,
    ArrayC  = 7,
    StructC = 8,
    Padding = 9,
}

// Size constants
export const HEADER_SIZE = 48; // sig(4) + ver(2) + csum(2) + fsize(4) + alloc(16) + flags(4) + project(4) + buildid(4) + fwver(4) + time(4)
export const SECTION_DESCRIPTOR_SIZE = 8;
export const MAXDWORD = 0xFFFFFFFF;
