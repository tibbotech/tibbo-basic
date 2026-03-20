// Indirection flags (2 higher bits of OPCODE byte)
export const OPCODE_DIRECT    = 0x00;
export const OPCODE_INDIRECT  = 0x40;
export const OPCODE_IMMEDIATE = 0x80;
export const OPCODE_INVALID   = 0xFF;

// No-operand instructions (0xC0 | operation)
export const OPCODE_CMP  = 0xC0;  // A cmp B -> flags
export const OPCODE_NEG  = 0xC1;  // -A -> A
export const OPCODE_NOT  = 0xC2;  // ~A -> A
export const OPCODE_AND  = 0xC3;  // A & B -> A
export const OPCODE_OR   = 0xC4;  // A | B -> A
export const OPCODE_XOR  = 0xC5;  // A ^ B -> A
export const OPCODE_ADD  = 0xC6;  // A + B -> A
export const OPCODE_SUB  = 0xC7;  // A - B -> A
export const OPCODE_MUL  = 0xC8;  // A * B -> A
export const OPCODE_DIV  = 0xC9;  // A / B -> A (unsigned)

// Load/store instructions (combinable with indirection flags)
export const OPCODE_LOA8  = 0x0A;  // load 8-bit unsigned into A (zero-extend)
export const OPCODE_LOA8I = 0x0B;  // load 8-bit signed into A (sign-extend)
export const OPCODE_LOA16 = 0x0C;  // load 16-bit into A (zero-extend in 32-bit)
export const OPCODE_LOB8  = 0x0D;  // load 8-bit unsigned into B (zero-extend)
export const OPCODE_LOB8I = 0x0E;  // load 8-bit signed into B (sign-extend)
export const OPCODE_LOB16 = 0x0F;  // load 16-bit into B (zero-extend in 32-bit)

// Store (OPCODE_DIRECT or OPCODE_INDIRECT only)
export const OPCODE_STO8  = 0x10;  // store lower 8 bits of A
export const OPCODE_STO16 = 0x11;  // store A (16-bit)

// Control flow
export const OPCODE_CALL = 0x12;
export const OPCODE_JMP  = 0x13;   // unconditional jump

// Conditional jumps
export const OPCODE_JE   = 0x14;   // jump if equal
export const OPCODE_JZ   = OPCODE_JE;
export const OPCODE_JNE  = 0x15;   // jump if not equal
export const OPCODE_JNZ  = OPCODE_JNE;
export const OPCODE_JG   = 0x16;   // jump if greater (signed)
export const OPCODE_JGE  = 0x17;   // jump if greater or equal (signed)
export const OPCODE_JA   = 0x18;   // jump if above (unsigned)
export const OPCODE_JAE  = 0x19;   // jump if above or equal (unsigned)
export const OPCODE_JL   = 0x1A;   // jump if less (signed)
export const OPCODE_JLE  = 0x1B;   // jump if less or equal (signed)
export const OPCODE_JB   = 0x1C;   // jump if below (unsigned)
export const OPCODE_JBE  = 0x1D;   // jump if below or equal (unsigned)

// Misc
export const OPCODE_SYSCALL  = 0x1E;  // followed by 1-byte syscall index
export const OPCODE_RET      = 0x1F;
export const OPCODE_HALT     = 0x20;
export const OPCODE_LEA      = 0x21;  // load 16-bit address into A

// Extended arithmetic (0xC0 | operation)
export const OPCODE_DIVI = 0xE2;  // A / B -> A (signed)
export const OPCODE_MOD  = 0xE3;  // A mod B -> A (unsigned)
export const OPCODE_MODI = 0xE4;  // A mod B -> A (signed)

export const OPCODE_SYSCALL2 = 0x25;  // followed by 2-byte syscall index
export const OPCODE_XCG      = 0x26;  // A <-> B

// Shift operations (0xC0 | operation)
export const OPCODE_SHL = 0xE7;  // A << B -> A
export const OPCODE_SHR = 0xE8;  // A >> B -> A

// Bitfield operations
export const OPCODE_LOABF  = 0x29;
export const OPCODE_LOABFI = 0x2A;
export const OPCODE_LOBBF  = 0x2B;
export const OPCODE_LOBBFI = 0x2C;
export const OPCODE_MRGBF  = 0x2D;

// 32-bit operations
export const OPCODE_LOAB32  = 0x2E;
export const OPCODE_STOAB32 = 0x2F;  // store AB (32-bit pair)
export const OPCODE_EXT32I  = 0x30;  // sign-extend A into AB

// Additional load/store (16-bit signed, 32-bit)
export const OPCODE_LOA16I = 0x31;  // load 16-bit signed into A
export const OPCODE_LOB16I = 0x32;  // load 16-bit signed into B
export const OPCODE_LOA32  = 0x33;  // load 32-bit into A
export const OPCODE_LOB32  = 0x34;  // load 32-bit into B
export const OPCODE_STO32  = 0x35;  // store 32-bit from A

// Reference types for TOBJ fixups
export enum ReferenceType {
    Code = 0,
    Init = 1,
    Html = 2,
}
