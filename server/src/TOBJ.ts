import {
    FILE_SIGNATURE,
    TOBJSectionDescriptor,
    TOBJ_SECTION_DESCRIPTOR,
    TOBJSourcePosition,
    TOBJSourceAnchor,
    TOBJScopeEntry,
    TOBJVariableEntry,
    TOBJVariableFlags,
    TOBJDataType,
    TOBJFunctionEntry,
    TOBJFunctionFlags,
    TOBJSourceFile,
    TOBJLineInfo,
    TOBJAddressEntry,
    TOBJAddressFlags,
    TOJBReferenceEntry,
    TOBJPropertyEntry,
    TOBJObjectEntry,
    TOBJTypeEntry,
    TOBJ_DATA_TYPES,
    TOBJEnumMember,
    TOBJStructMember
} from "./types";
const util = require('util');
const decoder = new util.TextDecoder();


export default class TOBJ {
    fileBuf: Buffer;
    fileName!: string;
    signature: FILE_SIGNATURE;
    version: string;
    checksum: number;
    fileSize: number;
    projectName: string;
    buildID: string;
    firmwareVersion: string;
    buildTime: Date;

    //TOBJ_ALLOC_INFO
    platformSize: number;
    globalAllocationSize: number;
    stackSize: number;
    localAllocSize: number;

    storageAddressStart: number;
    stackAddressStart: number;

    flags: number;
    scopes: Array<TOBJScopeEntry> = [];
    symbolStrings: string;
    variables: Array<TOBJVariableEntry> = [];
    functions: Array<TOBJFunctionEntry> = [];
    sourceFiles: Array<TOBJSourceFile> = [];
    addresses: Array<TOBJAddressEntry> = [];
    objects: Array<TOBJObjectEntry> = [];
    types: Array<TOBJTypeEntry> = [];
    //descriptors
    // sectionCode: TOBJSectionDescriptor;
    // sectionInit: TOBJSectionDescriptor;
    // sectionReadOnlyData: TOBJSectionDescriptor;
    // sectionFileData: TOBJSectionDescriptor;
    // sectionSymbols: TOBJSectionDescriptor;
    // sectionResources: TOBJSectionDescriptor;
    // sectionEventHandlers: TOBJSectionDescriptor;
    // sectionLibraries: TOBJSectionDescriptor;
    // sectionExtras: TOBJSectionDescriptor;
    descriptors: Array<TOBJSectionDescriptor> = [];


    constructor(buf: Buffer) {
        this.fileBuf = buf;
        this.signature = buf.toString('ascii', 0, 4) as FILE_SIGNATURE;
        this.version = buf[4] + '.' + buf[5];
        this.checksum = buf.readUInt16LE(6);
        this.fileSize = buf.readUInt32LE(8);

        this.platformSize = buf.readUInt32LE(12);
        this.globalAllocationSize = buf.readUInt32LE(16);
        this.stackSize = buf.readUInt32LE(20);
        this.localAllocSize = buf.readUInt32LE(24);

        this.stackAddressStart = this.platformSize + this.globalAllocationSize;
        this.storageAddressStart = this.platformSize + this.globalAllocationSize + this.stackSize + this.localAllocSize;

        this.flags = buf.readUInt32LE(28);

        const days = buf.readUInt16LE(44);
        // let minutes = buf.readUInt16LE(46);
        const buildTime = new Date();
        buildTime.setFullYear(2000, 0, 1);
        buildTime.setHours(0, 0, 0, 0);

        const date = new Date(buildTime.valueOf());
        date.setDate(date.getDate() + days);
        // date.setMinutes(date.getMinutes() + minutes);
        this.buildTime = date;

        let bufIndex = 48;
        let max = 9;
        if (this.signature != FILE_SIGNATURE.BIN_FILE_SIGNATURE) {
            max = 20;
        }
        for (let i = 0; i < max; i++) {
            this.descriptors.push({
                name: i,
                offset: buf.readUInt32LE(bufIndex),
                size: buf.readUInt32LE(bufIndex + 4),
                contents: ''
            });
            bufIndex += 8;
        }
        // var string = new TextDecoder("utf-8").decode(uint8array);
        for (let i = 0; i < max; i++) {
            const descriptor = this.descriptors[i];
            this.descriptors[i].contents = decoder.decode(buf.slice(descriptor.offset, descriptor.offset + descriptor.size));
            // this.descriptors[i].contents = String.fromCharCode.apply(null, buf.slice(descriptor.offset, descriptor.offset + descriptor.size));
            this.descriptors[i].buffer = buf.slice(descriptor.offset, descriptor.offset + descriptor.size);
        }

        // this.symbolStrings = String.fromCharCode.apply(null, this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_SYMBOLS].buffer);
        this.symbolStrings = decoder.decode(this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_SYMBOLS].buffer);

        this.projectName = this.getSYM(buf.readUInt32LE(32));
        this.buildID = this.getSYM(buf.readUInt32LE(36));
        this.firmwareVersion = this.getSYM(buf.readUInt32LE(40));

        // let fileSizeAtEnd = buf.readUInt32LE(buf.length - 8);
        // let signatureAtEnd = String.fromCharCode.apply(null, buf.slice(buf.length - 4, buf.length));

        this.parseScopes();
        this.parseAddresses();
        this.parseTypes();
        this.parseVariables();
        this.parseFunctions();
        this.parseLines();
        this.parseObjects();
    }

    getSYM(offset: number): string {
        const buffer = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_SYMBOLS].buffer;
        const start = offset;
        let str = '';
        if (buffer != null) {
            const end = buffer.indexOf(0x0, start, 'ascii');
            str = buffer.toString('ascii', start, end);
        }

        return str;
    }

    parseScopes(): void {
        //TOBJ_SECTION_SCOPES
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_SCOPES].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            const begin = this.getSourceAnchor(buf, index);
            const end = this.getSourceAnchor(buf, index + 16);
            index += 32;
            const scope: TOBJScopeEntry = {
                begin: begin,
                end: end
            };
            this.scopes.push(scope);
        }
    }

    getSourceAnchor(buf: Buffer, index: number): TOBJSourceAnchor {
        const srcPos: TOBJSourcePosition = {
            fileName: this.getSYM(buf.readUInt32LE(index)),
            line: buf.readUInt32LE(index + 4),
            column: buf.readUInt32LE(index + 8),
        };
        const srcAnchor: TOBJSourceAnchor = {
            sourcePosition: srcPos,
            address: buf.readUInt32LE(index + 12)
        };
        return srcAnchor;
    }

    parseVariables(): void {
        //TOBJ_SECTION_VARIABLES
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_VARIABLES].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            //TODO parse this properly
            const flags: TOBJVariableFlags = {
                isArgument: (buf[index] & 1) == 1,
                isByref: (buf[index] & 2) == 2,
                isTemporary: (buf[index] & 4) == 4,
                isStatic: (buf[index] & 8) == 8
            };

            const variable: TOBJVariableEntry = {
                flags: flags,
                name: this.getSYM(buf.readUInt32LE(index + 1)),
                address: this.addresses[buf.readUInt32LE(index + 5)],
                ownerScope: this.scopes[buf.readUInt32LE(index + 9)],
                dataType: this.readDataType(this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_VARIABLES].offset + index + 13)
            };
            this.addVariable(variable);

            index += 18;
        }
    }

    addVariable(variable: TOBJVariableEntry): void {
        this.variables.push(variable);
        const td = variable.dataType.typeDescription;
        if (variable.dataType.dataType === TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY
            && td?.referenceDataType
            && td.referenceDataType.dataType === TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT) {
            const arrayType = td.referenceDataType;
            const size = td.elementCount;
            for (let i = 0; i < size; i++) {
                this.addVariable({
                    flags: { ...variable.flags, isTemporary: true },
                    name: `${variable.name}[${i}]`,
                    address: {
                        ...variable.address,
                        address: variable.address.address + 2 + (i * (arrayType.typeDescription?.size ?? 0)),
                    },
                    ownerScope: variable.ownerScope,
                    dataType: arrayType,
                });
            }
        }
        if (variable.dataType.dataType === TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT && td) {
            for (let i = 0; i < td.structEntries.length; i++) {
                const member = td.structEntries[i];
                if (member.dataType.dataType === TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT) {
                    this.addVariable({
                        flags: { ...variable.flags, isTemporary: true },
                        name: `${variable.name}.${member.name}`,
                        address: {
                            ...variable.address,
                            address: variable.address.address + member.offset,
                        },
                        ownerScope: variable.ownerScope,
                        dataType: member.dataType,
                    });
                }
            }
        }
    }

    readDataType(offset: number): TOBJDataType {
        const dataType: TOBJDataType = {
            typeDescriptionIndex: -1,
            dataType: this.fileBuf[offset]
        }
        switch (dataType.dataType) {
            case TOBJ_DATA_TYPES.TOBJ_TYPE_STRING:
                dataType.typeDescriptionInline = this.fileBuf[offset + 1];
                break;
            case TOBJ_DATA_TYPES.TOBJ_TYPE_ENUM:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_POINTER:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_REFERENCE:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY_C:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT_C:
            case TOBJ_DATA_TYPES.TOBJ_TYPE_UNION:
                dataType.typeDescriptionIndex = this.fileBuf.readUInt32LE(offset + 1);
                dataType.typeDescription = this.types[this.fileBuf.readUInt32LE(offset + 1)];
                break;
        }

        return dataType;
    }

    parseFunctions(): void {
        //TOBJ_SECTION_FUNCTIONS
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_FUNCTIONS].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            //TODO parse this properly
            const flag: TOBJFunctionFlags = {
                isEvent: false,
                doevents: false,
                isHtml: false,
                isStatic: false,
            };

            const func: TOBJFunctionEntry = {
                flags: flag,
                name: this.getSYM(buf.readUInt32LE(index + 1)),
                address: this.addresses[buf.readUInt32LE(index + 5)],
                eventIndex: buf.readUInt32LE(index + 9),
                calleeIndices: [],
                callees: [],
            };
            const calleeCount = buf.readUInt32LE(index + 13);
            index += 17;
            this.functions.push(func);
            //functions called by this function
            for (let i = 0; i < calleeCount; i++) {
                const calleeIndex = buf.readUInt32LE(index);
                func.calleeIndices.push(calleeIndex);
                index += 4;
            }
        }
        for (let i = 0; i < this.functions.length; i++) {
            for (let j = 0; j < this.functions[i].calleeIndices.length; j++) {
                const index = this.functions[i].calleeIndices[j];
                this.functions[i].callees.push(this.functions[index]);
            }
        }
    }

    parseLines(): void {
        //TOBJ_SECTION_LINE_INFO
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_LINE_INFO].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            //TODO parse this properly
            const lines: Array<TOBJLineInfo> = [];
            const fileEntry: TOBJSourceFile = {
                fileName: this.getSYM(buf.readUInt32LE(index)),
                lineCount: buf.readUInt32LE(index + 4),
                lines: lines
            };
            index += 8;
            for (let i = 0; i < fileEntry.lineCount; i++) {
                const lineInfo: TOBJLineInfo = {
                    line: buf.readUInt32LE(index),
                    address: buf.readUInt32LE(index + 4),
                };
                lines.push(lineInfo);
                index += 8;
            }
            this.sourceFiles.push(fileEntry);
        }
    }

    parseAddresses(): void {
        //TOBJ_ADDRESS_ENTRY
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_ADDRESSES].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            //TODO parse this properly
            const flags: TOBJAddressFlags = {
                isDefined: false,
                isPublic: false,
                isCode: false,
                isInit: false
            }
            const address: TOBJAddressEntry = {
                flags: flags,
                tag: buf.readUInt32LE(index + 1),
                address: buf.readUInt32LE(index + 5),
                baseAddress: buf.readUInt32LE(index + 9),
                refCount: buf.readUInt32LE(index + 13),
                references: []
            }

            this.addresses.push(address);
            index += 17;
            for (let i = 0; i < address.refCount; i++) {
                const ref: TOJBReferenceEntry = {
                    referenceType: buf[index],
                    referencedFrom: buf.readUInt32LE(index + 1)
                }
                address.references.push(ref);
                index += 5;
            }
        }
    }

    parseObjects(): void {
        //TOBJ_OBJECT_ENTRY
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_OBJECTS].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            //TODO parse this properly
            const count = buf.readUInt32LE(index + 4);
            const obj: TOBJObjectEntry = {
                name: this.getSYM(buf.readUInt32LE(index)),
                properties: []
            };
            index += 8;
            for (let i = 0; i < count; i++) {
                const property: TOBJPropertyEntry = {
                    name: this.getSYM(buf.readUInt32LE(index)),
                    syscallGet: buf.readUInt32LE(index + 4),
                    syscallSet: buf.readUInt32LE(index + 8),
                    dataType: this.readDataType(this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_OBJECTS].offset + index + 12)
                }
                obj.properties.push(property);
                index += 17;
            }
            this.objects.push(obj);
        }
    }

    parseTypes(): void {
        //TOBJ_TYPE_ENTRY
        const buf = this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_TYPES].buffer;
        let index = 0;
        if (buf == undefined) {
            return;
        }
        while (index < buf.length) {
            const customType: TOBJTypeEntry = {
                dataType: buf[index],
                name: this.getSYM(buf.readUInt32LE(index + 1)),
                size: buf.readUInt32LE(index + 5),
                elementCount: buf.readUInt32LE(index + 9),
                referenceCount: buf.readUInt32LE(index + 13),
                enumEntries: [],
                structEntries: []
            };
            index += 17;
            switch (customType.dataType) {
                case TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY:
                case TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY_C:
                case TOBJ_DATA_TYPES.TOBJ_TYPE_POINTER:
                case TOBJ_DATA_TYPES.TOBJ_TYPE_REFERENCE:
                    customType.referenceDataType = this.readDataType(this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_TYPES].offset + index);
                    index += 5;
                    index += customType.referenceCount * 5;
                    break;
                case TOBJ_DATA_TYPES.TOBJ_TYPE_ENUM:
                    {
                        const baseType: TOBJ_DATA_TYPES = buf[index];
                        index++;
                        for (let i = 0; i < customType.elementCount; i++) {
                            const en: TOBJEnumMember = {
                                baseType: baseType,
                                name: this.getSYM(buf.readUInt32LE(index)),
                                value: buf.readUInt32LE(index + 4)
                            }
                            customType.enumEntries.push(en);
                            index += 8;
                        }
                    }
                    break;
                case TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT:
                case TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT_C:
                case TOBJ_DATA_TYPES.TOBJ_TYPE_UNION:
                    for (let i = 0; i < customType.elementCount; i++) {
                        const entry: TOBJStructMember = {
                            name: this.getSYM(buf.readUInt32LE(index)),
                            dataType: this.readDataType(this.descriptors[TOBJ_SECTION_DESCRIPTOR.TOBJ_SECTION_TYPES].offset + index + 4),
                            offset: buf.readUInt32LE(index + 9)
                        }
                        customType.structEntries.push(entry);
                        index += 13;
                    }
                    index += customType.referenceCount * 5;
                    break;
            }
            //reference entries


            this.types.push(customType);
        }

        for (let i = 0; i < this.types.length; i++) {
            this.setType(this.types[i]);
        }
    }

    setType(typeItem: TOBJTypeEntry): void {
        if (typeItem.dataType == TOBJ_DATA_TYPES.TOBJ_TYPE_STRUCT) {
            for (let i = 0; i < typeItem.structEntries.length; i++) {
                if (typeItem.structEntries[i].dataType.typeDescriptionIndex >= 0 && typeItem.structEntries[i].dataType.typeDescription == undefined) {
                    typeItem.structEntries[i].dataType.typeDescription = this.types[typeItem.structEntries[i].dataType.typeDescriptionIndex];
                }
            }
        }
        else if (typeItem.dataType == TOBJ_DATA_TYPES.TOBJ_TYPE_ARRAY && typeItem.referenceDataType) {
            if (typeItem.referenceDataType.typeDescriptionIndex >= 0 && typeItem.referenceDataType.typeDescription == undefined) {
                typeItem.referenceDataType.typeDescription = this.types[typeItem.referenceDataType.typeDescriptionIndex];
            }
        }
    }
}

