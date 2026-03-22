import { CommonToken } from "antlr4/Token";

export interface TBDefine {
    name: string,
    value: string,
    line: number
}

export interface TBVariable {
    name: string,
    value?: string,
    dataType: string,
    length: string,
    location: TBRange,
    declaration?: TBRange,
    comments?: Array<CommonToken>,
    parentScope?: TBScope,
    references: Array<TBRange>
}

export interface TBParameter {
    name: string,
    byRef: boolean,
    dataType: string
}

export interface TBObject {
    name: string,
    properties: Array<TBObjectProperty>,
    functions: Array<TBFunction>,
    location: TBRange,
    comments: Array<CommonToken>,
    events: Array<TBEvent>,
}

export interface TBObjectProperty {
    name: string,
    dataType: string,
    get?: TBSyscall,
    set?: TBSyscall,
    location: TBRange,
    comments: Array<CommonToken>,
}

export enum TBSymbolType {
    ENUM = 'enum',
    ENUM_MEMBER = 'enum_member',
    TYPE = 'type',
    TYPE_MEMBER = 'type_member',
    FUNCTION = 'function',
    SUB = 'sub',
    DIM = 'dim',
    CONST = 'const',
    OBJECT = 'object',
    OBJECT_PROPERTY = 'object_property',
    SYSCALL = 'syscall',
    DEFINE = 'define'

}

export interface TBRange {
    startToken: CommonToken,
    stopToken: CommonToken
}

export interface TBEvent {
    name: string,
    eventNumber: number,
    parameters: Array<TBParameter>,
    location: TBRange,
    comments: Array<CommonToken>,
}

export interface TBSyscall {
    name: string,
    syscallNumber?: number,
    tdl?: string,
    parameters: Array<TBParameter>,
    dataType: string,
    location: TBRange,
    comments: Array<CommonToken>,
}

export interface TBSyntaxError {
	symbol: CommonToken,
	line: number,
	column: number,
	message: string
}

export interface TBEnum {
    name: string,
    members: Array<TBEnumEntry>,
    location: TBRange,
    comments: Array<CommonToken>
}

export interface TBFunction {
    name: string,
    parameters: Array<TBParameter>,
    syscall?: TBSyscall,
    dataType?: string,
    location?: TBRange,
    declaration?: TBRange,
    comments?: Array<CommonToken>,
    variables: Array<TBVariable>,
    references?: Array<TBRange>
}

export interface TBConst {
    name: string,
    value: string,
    location: TBRange,
    comments: Array<CommonToken>
}

export interface TBSymbol {
    location: TBRange
}

export interface TBScope {
    file: string,
    start: CommonToken,
    end: CommonToken,
    parentScope?: TBScope
}

export interface TBType {
    name: string,
    members: Array<TBVariable>,
    location: TBRange,
    comments: Array<CommonToken>,   
}

export interface TBEnumEntry {
    name: string,
    value: string,
    location: TBRange,
    comments: Array<CommonToken>
}

export enum PCODE_COMMANDS {
    STATE = "PC",
    RUN = "PR",
    PAUSE = "PB",
    BREAKPOINT = "CB",
    GET_MEMORY = "GM",
    GET_PROPERTY = "GP",
    SET_PROPERTY = "SR",
    SET_MEMORY = "SM",
    STEP = "PO",
    SET_POINTER = "SP",
    DISCOVER = "_?",
    INFO = "X",
    RESET_PROGRAMMING = "Q",
    UPLOAD = "D",
    APPUPLOADFINISH = "T",
    BUZZ = "B",
    REBOOT = "E"
}

export interface TaikoMessage {
    mac: string;
    command: PCODE_COMMANDS;
    data: string;
    nonce?: string;
}

export interface TOBJLineInfo {
    line: number,
    address: number
}

export interface TibboDeviceState {
    state: PCODEMachineState;
    registerA: number;
    registerB: number;
    pcodeCounter: number;
    stackPointer: number;
    flags: string;
}

export enum PCODEMachineState {
    STOPPED = '***',
    RUN = '*R*',
    PAUSED = '**B',
    DEBUG_PRINT_AND_STOP = '**P',
    DEBUG_PRINT_AND_CONTINUE = '*P*'
}

export enum TIBBO_PROXY_MESSAGE {
    REFRESH = 'refresh',
    DEVICE = 'device',
    BUZZ = 'buzz',
    REBOOT = 'reboot',
    UPLOAD = 'upload',
    REGISTER = 'register',
    APPLICATION_UPLOAD = 'application',
    UPLOAD_COMPLETE = 'upload_complete',
    STATE = 'state',
    COMMAND = 'command',
    REPLY = 'reply',
    SET_PDB_STORAGE_ADDRESS = 'set_pdb_storage_address',
    DEBUG_PRINT = 'debug_print',
}

export enum TOBJ_DATA_TYPES {
    TOBJ_TYPE_UNKNOWN = 0,
    TOBJ_TYPE_BOOLEAN = 1,
    TOBJ_TYPE_BYTE = 2,
    TOBJ_TYPE_CHAR = 3,
    TOBJ_TYPE_WORD = 4,
    TOBJ_TYPE_SHORT = 5,
    TOBJ_TYPE_DWORD = 6,
    TOBJ_TYPE_LONG = 7,
    TOBJ_TYPE_REAL = 8,
    TOBJ_TYPE_STRING = 9,
    TOBJ_TYPE_ENUM = 10,
    TOBJ_TYPE_ARRAY = 11,
    TOBJ_TYPE_STRUCT = 12,
    TOBJ_TYPE_VOID = 13,
    TOBJ_TYPE_BITFIELD = 14,
    TOBJ_TYPE_POINTER = 15,
    TOBJ_TYPE_REFERENCE = 16,
    TOBJ_TYPE_ARRAY_C = 17,
    TOBJ_TYPE_STRUCT_C = 18,
    TOBJ_TYPE_UNION = 19,
}

export interface TOBJVariableEntry {
    flags: TOBJVariableFlags,
    name: string,
    address: TOBJAddressEntry,
    value?: string,
    ownerScope: TOBJScopeEntry,
    dataType: TOBJDataType
}

export interface TOBJVariableFlags {
    isArgument: boolean,
    isByref: boolean,
    isTemporary: boolean,
    isStatic: boolean
}

export interface TOBJAddressEntry {
    /**
     * Combination of TOBJ_ADDRESS_FLAGS
     */
    flags: TOBJAddressFlags
    /**
     * Address tag (e.g., the mangled name of a function)
     */
    tag: number
    /**
     * Depending on m_Flags, this is an address in TOBJ_SECTION_CODE, TOBJ_SECTION_INIT, or RAM
     */
    address: number
    /**
     * If this is a relative address (e.g., the address of a struct field) 
     * then m_dwBaseAddress holds index of TOBJ_ADDRESS_ENTRY of the parent address); 
     * otherwise, it’s set to 0xffffffff
     */
    baseAddress: number
    /**
     * Number of references to this address
     */
    refCount: number
    references: Array<TOJBReferenceEntry>
}

export interface TOBJScopeEntry {
    begin: TOBJSourceAnchor,
    end: TOBJSourceAnchor
}

export interface TOJBReferenceEntry {
    referenceType: TOBJ_REFERENCE_TYPES,
    referencedFrom: number
}

export interface TOBJDataType {
    dataType: TOBJ_DATA_TYPES,
    typeDescriptionInline?: number,
    typeDescriptionIndex: number,
    typeDescription?: TOBJTypeEntry
}

export interface TOBJAddressFlags {
    isDefined: boolean
    isPublic: boolean
    isCode: boolean
    isInit: boolean
}

export interface TOBJSourceAnchor {
    sourcePosition: TOBJSourcePosition,
    address: number
}

export enum TOBJ_REFERENCE_TYPES {
    TOBJ_REF_CODE = 0,
    TOBJ_REF_INIT = 1,
    TOBJ_REF_HTML = 2
}

export interface TOBJTypeEntry {
    dataType: TOBJ_DATA_TYPES,
    name: string,
    size: number,
    elementCount: number,//For arrays, it’s the number of elements; for enums, structs & unions, it’s the number of member fields.
    referenceCount: number, //Number of references to this typedesc
    referenceDataType?: TOBJDataType,
    enumEntries: Array<TOBJEnumMember>,
    structEntries: Array<TOBJStructMember>,
}

export interface TOBJSourcePosition {
    fileName: string,
    line: number,
    column: number
}

export interface TOBJEnumMember {
    baseType: TOBJ_DATA_TYPES,
    name: string,
    value: number
}

export interface TOBJStructMember {
    name: string,
    dataType: TOBJDataType,
    offset: number
}

export interface TOBJPropertyEntry {
    name: string,
    syscallGet: number,
    syscallSet: number,
    dataType: TOBJDataType
}

export const TOBJ_DATA_TYPES_NAMES = [
    'unknown',
    'boolean',
    'byte',
    'char',
    'word',
    'short',
    'dword',
    'long',
    'real',
    'string',
    'enum',
    'array',
    'struct',
    'void',
    'bitfield',
    'pointer',
    'reference',
    'array_c',
    'struct_c',
    'union'
]

export interface TOBJFunctionEntry {
    flags: TOBJFunctionFlags,
    name: string,
    address: TOBJAddressEntry,
    eventIndex: number,
    calleeIndices: Array<number>,
    callees: Array<TOBJFunctionEntry>
}

export interface TOBJFunctionFlags {
    isEvent: boolean,
    doevents: boolean,
    isHtml: boolean,
    isStatic: boolean,
}

export enum FILE_SIGNATURE {
    OBJ_FILE_SIGNATURE = "TOBJ",
    PDB_FILE_SIGNATURE = "TPDB",
    BIN_FILE_SIGNATURE = "TBIN"
}

export interface TOBJSectionDescriptor {
    name: TOBJ_SECTION_DESCRIPTOR;
    offset: number;
    size: number;
    buffer?: Buffer;
    contents?: string;
}

export enum TOBJ_SECTION_DESCRIPTOR {
    TOBJ_SECTION_CODE = 0,
    TOBJ_SECTION_INIT = 1,
    TOBJ_SECTION_RDATA = 2,
    TOBJ_SECTION_FILE_DATA = 3,
    TOBJ_SECTION_SYMBOLS = 4,
    TOBJ_SECTION_RES_FILE_DIR = 5,
    TOBJ_SECTION_EVENT_DIR = 6,
    TOBJ_SECTION_LIB_FILE_DIR = 7,
    TOBJ_SECTION_EXTRA = 8,
    TOBJ_SECTION_ADDRESSES = 9,
    TOBJ_SECTION_FUNCTIONS = 10,
    TOBJ_SECTION_SCOPES = 11,
    TOBJ_SECTION_VARIABLES = 12,
    TOBJ_SECTION_OBJECTS = 13,
    TOBJ_SECTION_SYSCALLS = 14,
    TOBJ_SECTION_TYPES = 15,
    TOBJ_SECTION_RDATA_DIR = 16,
    TOBJ_SECTION_LINE_INFO = 17,
    TOBJ_SECTION_LIB_NAME_DIR = 18,
    TOBJ_SECTION_INC_NAME_DIR = 19,
}

export interface TOBJSourceFile {
    fileName: string,
    lineCount: number,
    lines: Array<TOBJLineInfo>
}

export interface TOBJObjectEntry {
    name: string,
    properties: Array<TOBJPropertyEntry>
}

export interface TibboDevice {
    ip: string;
    mac: string;
    messageQueue: Array<TaikoMessage>;
    tios: string;
    app: string;
    file?: Buffer;
    fileIndex: number;
    fileBlocksTotal: number;
    pcode: PCODE_STATE;
    lastRunCommand?: TaikoMessage;
    state: PCODEMachineState;
    pdbStorageAddress?: number;
    type: string;
}

export enum PCODE_STATE {
    STOPPED = 0,
    PAUSED = 1,
    RUNNING = 2
}