import {
    TOBJ_SIGNATURE_OBJ, TOBJ_SIGNATURE_BIN, TOBJ_VERSION,
    TObjSection, TObjHeaderFlags, TObjAddressFlags, TObjRefType,
    HEADER_SIZE, SECTION_DESCRIPTOR_SIZE, MAXDWORD,
} from '../tobj/format';
import { BinaryWriter } from '../tobj/writer';
import { DiagnosticCollection } from '../errors';

export interface LinkerOptions {
    projectName?: string;
    buildId?: string;
    firmwareVer?: string;
    configStr?: string;
    platformSize?: number;
    stackSize?: number;
    localAllocSize?: number;
    globalAllocSize?: number;
    maxEventNumber?: number;
    flags?: number;
    fixedTimestamp?: Date;
}

interface ObjFile {
    name: string;
    data: Buffer;
    sections: SectionInfo[];
    header: ObjHeader;
}

interface SectionInfo {
    offset: number;
    size: number;
    data: Buffer;
}

interface ObjHeader {
    signature: number;
    version: number;
    checksum: number;
    fileSize: number;
    platformSize: number;
    globalAllocSize: number;
    stackSize: number;
    localAllocSize: number;
    flags: number;
    projectName: number;
    buildId: number;
    firmwareVer: number;
}

interface LinkedAddress {
    flags: number;
    tag: string;
    address: number;
    baseAddress: number;
    references: LinkedReference[];
}

interface LinkedReference {
    type: number;
    offset: number;
}

interface RDataReloc {
    codeOffset: number;
    refType: number;
    rdataTarget: number;
}

export class Linker {
    private diagnostics: DiagnosticCollection;
    private options: LinkerOptions;
    private mergedCode: number[] = [];
    private mergedInit: number[] = [];
    private mergedRData: number[] = [];
    private mergedFileData: number[] = [];
    private mergedObjSymbols: number[] = [];
    private addresses: LinkedAddress[] = [];
    private symbolOffsets = new Map<string, number>();
    private eventEntries: { codeAddress: number; dataAddress: number }[] = [];
    private eventEntryCount = 0;
    private rdataRelocs: RDataReloc[] = [];
    private flags = 0;
    private totalGlobalSize = 0;
    private maxLocalAllocSize = 0;

    constructor(diagnostics: DiagnosticCollection, options: LinkerOptions = {}) {
        this.diagnostics = diagnostics;
        this.options = options;
    }

    link(objBuffers: { name: string; data: Buffer }[]): Buffer {
        const objFiles = objBuffers.map(b => this.loadObj(b.name, b.data));

        for (const obj of objFiles) {
            this.linkObj(obj);
        }

        return this.emit();
    }

    private loadObj(name: string, data: Buffer): ObjFile {
        if (data.length < HEADER_SIZE) {
            this.diagnostics.error({ file: name, line: 0, column: 0 }, 'Invalid object file: too small');
            return { name, data, sections: [], header: this.emptyHeader() };
        }

        const signature = data.readUInt32LE(0);
        if (signature !== TOBJ_SIGNATURE_OBJ) {
            this.diagnostics.error({ file: name, line: 0, column: 0 }, 'Invalid object file signature');
            return { name, data, sections: [], header: this.emptyHeader() };
        }

        const header: ObjHeader = {
            signature,
            version: data.readUInt16LE(4),
            checksum: data.readUInt16LE(6),
            fileSize: data.readUInt32LE(8),
            platformSize: data.readUInt32LE(12),
            globalAllocSize: data.readUInt32LE(16),
            stackSize: data.readUInt32LE(20),
            localAllocSize: data.readUInt32LE(24),
            flags: data.readUInt32LE(28),
            projectName: data.readUInt32LE(32),
            buildId: data.readUInt32LE(36),
            firmwareVer: data.readUInt32LE(40),
        };

        this.flags |= header.flags;

        const sectionCount = TObjSection.CountObj;
        const sections: SectionInfo[] = [];
        const descStart = HEADER_SIZE;

        for (let i = 0; i < sectionCount; i++) {
            const descOffset = descStart + i * SECTION_DESCRIPTOR_SIZE;
            if (descOffset + 8 > data.length) {
                sections.push({ offset: 0, size: 0, data: Buffer.alloc(0) });
                continue;
            }
            const offset = data.readUInt32LE(descOffset);
            const size = data.readUInt32LE(descOffset + 4);
            const secData = (offset + size <= data.length)
                ? data.slice(offset, offset + size)
                : Buffer.alloc(0);
            sections.push({ offset, size, data: secData });
        }

        return { name, data, sections, header };
    }

    private linkObj(obj: ObjFile): void {
        if (obj.sections.length === 0) return;

        const codeBase = this.mergedCode.length;
        const initBase = this.mergedInit.length;
        const rdataBase = this.mergedRData.length;

        // Merge CODE
        const codeData = obj.sections[TObjSection.Code]?.data;
        if (codeData) {
            for (const b of codeData) this.mergedCode.push(b);
        }

        // Merge INIT
        const initData = obj.sections[TObjSection.Init]?.data;
        if (initData) {
            for (const b of initData) this.mergedInit.push(b);
        }

        // Merge RDATA
        const rdataData = obj.sections[TObjSection.RData]?.data;
        if (rdataData) {
            for (const b of rdataData) this.mergedRData.push(b);
        }

        // Keep OBJ symbols for address resolution
        const symbolData = obj.sections[TObjSection.Symbols]?.data;
        if (symbolData) {
            for (const b of symbolData) this.mergedObjSymbols.push(b);
        }

        // Merge FILE_DATA
        const fileData = obj.sections[TObjSection.FileData]?.data;
        if (fileData) {
            for (const b of fileData) this.mergedFileData.push(b);
        }

        // Merge ADDRESSES
        this.linkAddresses(obj, codeBase, initBase);

        // Merge EVENT_DIR (entries are indexed by event number)
        const eventData = obj.sections[TObjSection.EventDir]?.data;
        if (eventData && eventData.length >= 8) {
            const entryCount = eventData.length / 8;
            if (entryCount > this.eventEntryCount) {
                this.eventEntryCount = entryCount;
            }
            for (let i = 0; i < entryCount; i++) {
                const codeAddr = eventData.readUInt32LE(i * 8);
                const dataAddr = eventData.readUInt32LE(i * 8 + 4);
                if (codeAddr !== MAXDWORD) {
                    this.eventEntries[i] = {
                        codeAddress: codeAddr + codeBase,
                        dataAddress: dataAddr,
                    };
                }
            }
        }

        // Build EventDir from Functions section (events defined via TOBJ_FUNCTION_ENTRY)
        this.linkFunctions(obj, codeBase);

        // Process RDataDir for RData relocations
        this.linkRDataDir(obj, codeBase, initBase, rdataBase);

        this.totalGlobalSize += obj.header.globalAllocSize;
        if (obj.header.localAllocSize > this.maxLocalAllocSize) {
            this.maxLocalAllocSize = obj.header.localAllocSize;
        }
    }

    private linkFunctions(obj: ObjFile, codeBase: number): void {
        const funcData = obj.sections[TObjSection.Functions]?.data;
        if (!funcData || funcData.length === 0) return;

        let pos = 0;
        while (pos + 17 <= funcData.length) {
            const flags = funcData.readUInt8(pos); pos += 1;
            const _nameRef = funcData.readUInt32LE(pos); pos += 4;
            const addrIdx = funcData.readUInt32LE(pos); pos += 4;
            const eventIdx = funcData.readUInt32LE(pos); pos += 4;
            const calleeCount = funcData.readUInt32LE(pos); pos += 4;

            pos += calleeCount * 4;

            if (!(flags & 1)) continue; // TOBJ_FUN_EVENT

            // Resolve code address from the Addresses section
            const addrData = obj.sections[TObjSection.Addresses]?.data;
            if (!addrData) continue;

            let addrPos = 0;
            let curIdx = 0;
            let codeAddress = MAXDWORD;
            while (addrPos < addrData.length) {
                if (addrPos + 17 > addrData.length) break;
                const aFlags = addrData.readUInt8(addrPos);
                const _aTag = addrData.readUInt32LE(addrPos + 1);
                const aAddr = addrData.readUInt32LE(addrPos + 5);
                const _aBase = addrData.readUInt32LE(addrPos + 9);
                const aRefCount = addrData.readUInt32LE(addrPos + 13);
                addrPos += 17 + aRefCount * 5;

                if (curIdx === addrIdx) {
                    if (aFlags & TObjAddressFlags.Code) {
                        codeAddress = aAddr + codeBase;
                    } else {
                        codeAddress = aAddr;
                    }
                    break;
                }
                curIdx++;
            }

            if (codeAddress !== MAXDWORD) {
                if (eventIdx + 1 > this.eventEntryCount) {
                    this.eventEntryCount = eventIdx + 1;
                }
                this.eventEntries[eventIdx] = {
                    codeAddress,
                    dataAddress: 0, // set during emit
                };
            }
        }
    }

    private linkRDataDir(obj: ObjFile, codeBase: number, initBase: number, rdataBase: number): void {
        const rdataDirData = obj.sections[TObjSection.RDataDir]?.data;
        if (!rdataDirData || rdataDirData.length === 0) return;

        let pos = 0;
        while (pos + 12 <= rdataDirData.length) {
            const rdataOff = rdataDirData.readUInt32LE(pos); pos += 4;
            const _rdataSize = rdataDirData.readUInt32LE(pos); pos += 4;
            const refCount = rdataDirData.readUInt32LE(pos); pos += 4;

            const mergedRDataOffset = rdataOff + rdataBase;

            for (let r = 0; r < refCount; r++) {
                if (pos + 5 > rdataDirData.length) break;
                const refType = rdataDirData.readUInt8(pos); pos += 1;
                const refFrom = rdataDirData.readUInt32LE(pos); pos += 4;

                let adjustedFrom = refFrom;
                if (refType === TObjRefType.Code) {
                    adjustedFrom += codeBase;
                } else if (refType === TObjRefType.Init) {
                    adjustedFrom += initBase;
                }

                this.rdataRelocs.push({
                    codeOffset: adjustedFrom,
                    refType,
                    rdataTarget: mergedRDataOffset,
                });
            }
        }
    }

    private linkAddresses(obj: ObjFile, codeBase: number, initBase: number): void {
        const addrData = obj.sections[TObjSection.Addresses]?.data;
        if (!addrData || addrData.length === 0) return;

        let pos = 0;
        while (pos < addrData.length) {
            if (pos + 17 > addrData.length) break;

            const flags = addrData.readUInt8(pos); pos += 1;
            const tag = addrData.readUInt32LE(pos); pos += 4;
            let address = addrData.readUInt32LE(pos); pos += 4;
            const baseAddress = addrData.readUInt32LE(pos); pos += 4;
            const refCount = addrData.readUInt32LE(pos); pos += 4;

            // Relocate address
            if (flags & TObjAddressFlags.Code) {
                address += codeBase;
            } else if (flags & TObjAddressFlags.Init) {
                address += initBase;
            }

            const refs: LinkedReference[] = [];
            for (let i = 0; i < refCount; i++) {
                if (pos + 5 > addrData.length) break;
                const refType = addrData.readUInt8(pos); pos += 1;
                let refOffset = addrData.readUInt32LE(pos); pos += 4;

                if (refType === TObjRefType.Code) refOffset += codeBase;
                else if (refType === TObjRefType.Init) refOffset += initBase;

                refs.push({ type: refType, offset: refOffset });
            }

            const symbolSection = obj.sections[TObjSection.Symbols]?.data;
            let tagName = '';
            if (symbolSection && tag < symbolSection.length) {
                let i = tag;
                while (i < symbolSection.length && symbolSection[i] !== 0) {
                    tagName += String.fromCharCode(symbolSection[i]);
                    i++;
                }
            }

            // Merge or add address
            const existing = this.addresses.find(a => a.tag === tagName && tagName !== '');
            if (existing) {
                if ((flags & TObjAddressFlags.Defined) && !(existing.flags & TObjAddressFlags.Defined)) {
                    existing.flags |= TObjAddressFlags.Defined;
                    existing.address = address;
                }
                existing.references.push(...refs);
            } else {
                this.addresses.push({ flags, tag: tagName, address, baseAddress, references: refs });
            }
        }
    }

    private emit(): Buffer {
        // Add RET at end of init section (init code needs to return after running)
        if (this.mergedInit.length > 0) {
            this.mergedInit.push(0x1F); // OPCODE_RET
        }

        // Relocate: prepend init to code
        const initSize = this.mergedInit.length;
        const fullCode = [...this.mergedInit, ...this.mergedCode];

        if (initSize > 0) {
            for (const addr of this.addresses) {
                if (addr.flags & TObjAddressFlags.Code) {
                    addr.address += initSize;
                }
                for (const ref of addr.references) {
                    if (ref.type === TObjRefType.Code) {
                        ref.offset += initSize;
                    }
                }
            }

            for (let i = 0; i < this.eventEntries.length; i++) {
                if (this.eventEntries[i]) {
                    this.eventEntries[i].codeAddress += initSize;
                }
            }
        }

        // Apply address fixups
        const useCode24 = !!(this.flags & TObjHeaderFlags.Code24);
        const addrSize = useCode24 ? 3 : 2;

        for (const addr of this.addresses) {
            if (!(addr.flags & TObjAddressFlags.Defined)) continue;
            for (const ref of addr.references) {
                const offset = ref.offset;
                if (ref.type === TObjRefType.Code || ref.type === TObjRefType.Init) {
                    if (offset + addrSize <= fullCode.length) {
                        fullCode[offset] = addr.address & 0xFF;
                        fullCode[offset + 1] = (addr.address >> 8) & 0xFF;
                        if (useCode24 && offset + 2 < fullCode.length) {
                            fullCode[offset + 2] = (addr.address >> 16) & 0xFF;
                        }
                    }
                }
            }
        }

        // Apply RData relocations: adjust RData offsets in code after init prepend
        for (const reloc of this.rdataRelocs) {
            let offset = reloc.codeOffset;
            if (reloc.refType === TObjRefType.Code) {
                offset += initSize;
            }
            // Init refs already have correct offsets (init is at the start of fullCode)
            if (offset + addrSize <= fullCode.length) {
                fullCode[offset] = reloc.rdataTarget & 0xFF;
                fullCode[offset + 1] = (reloc.rdataTarget >> 8) & 0xFF;
                if (useCode24 && offset + 2 < fullCode.length) {
                    fullCode[offset + 2] = (reloc.rdataTarget >> 16) & 0xFF;
                }
            }
        }

        const sectionCount = TObjSection.CountBin;
        const codeBuffer = Buffer.from(fullCode);
        const rdataBuffer = Buffer.from(this.mergedRData);
        const fileDataBuffer = Buffer.from(this.mergedFileData);

        // Build minimal BIN symbols section
        const binSymStrings = new BinSymbolStringTable();
        const configStr = this.options.configStr || '';
        const projectName = this.options.projectName || '';
        const buildId = this.options.buildId || '';
        const firmwareVer = this.options.firmwareVer || '';

        const configOff = binSymStrings.add(configStr);
        const projectNameOff = binSymStrings.add(projectName);
        const buildIdOff = binSymStrings.add(buildId);
        const firmwareVerOff = binSymStrings.add(firmwareVer);

        const now = this.options.fixedTimestamp ?? new Date();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = dayNames[now.getDay()];
        const month = monthNames[now.getMonth()];
        const dd = String(now.getDate()).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        const yyyy = String(now.getFullYear()).slice(-2);
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${day}, ${dd}-${month}-${yy} ${hh}:${mm}:${ss} ${yyyy}${String(now.getMonth()+1).padStart(2,'0')}${dd}${hh}${mm}${ss}`;
        const timeStrOff = binSymStrings.add(timeStr);

        const symbolsBuffer = binSymStrings.toBuffer();

        // Build event dir (fixed-size array indexed by event number)
        const eventW = new BinaryWriter();
        const platformSize = this.options.platformSize ?? 0;
        const stackSize = this.options.stackSize ?? 0;
        const globalAllocSize = this.options.globalAllocSize ?? this.totalGlobalSize;
        const totalDataSize = globalAllocSize + platformSize + stackSize;

        const maxEventNumber = this.options.maxEventNumber ?? 0;
        const eventDirSize = Math.max(this.eventEntryCount, maxEventNumber);

        for (let i = 0; i < eventDirSize; i++) {
            const entry = this.eventEntries[i];
            if (entry) {
                eventW.writeDword(entry.codeAddress);
                eventW.writeDword(totalDataSize);
            } else {
                eventW.writeDword(MAXDWORD);
                eventW.writeDword(MAXDWORD);
            }
        }
        const eventDirBuffer = eventW.toBuffer();

        // Build extra section (3 dword offsets into symbols)
        const extraW = new BinaryWriter();
        extraW.writeDword(timeStrOff);
        extraW.writeDword(MAXDWORD);  // src file path - not used in release
        extraW.writeDword(configOff);
        const extraBuffer = extraW.toBuffer();

        // Layout: Extra, EventDir, Symbols, RData, Code
        const headerAndDescSize = HEADER_SIZE + sectionCount * SECTION_DESCRIPTOR_SIZE;
        let currentOffset = headerAndDescSize;

        const extraOffset = currentOffset;
        currentOffset += extraBuffer.length;

        const eventDirOffset = currentOffset;
        currentOffset += eventDirBuffer.length;

        const symbolsOffset = currentOffset;
        currentOffset += symbolsBuffer.length;

        const rdataOffset = currentOffset;
        currentOffset += rdataBuffer.length;

        const codeOffset = currentOffset;
        currentOffset += codeBuffer.length;

        const fileSize = currentOffset + 8; // + terminator

        // Empty sections: Init uses offset 0 (merged into Code), others share RData offset
        const emptyDataOffset = rdataOffset;

        const offsets: number[] = new Array(sectionCount).fill(0);
        const sizes: number[] = new Array(sectionCount).fill(0);

        offsets[TObjSection.Code] = codeOffset;             sizes[TObjSection.Code] = codeBuffer.length;
        offsets[TObjSection.Init] = 0;                      sizes[TObjSection.Init] = 0;
        offsets[TObjSection.RData] = rdataOffset;            sizes[TObjSection.RData] = rdataBuffer.length;
        offsets[TObjSection.FileData] = emptyDataOffset;     sizes[TObjSection.FileData] = 0;
        offsets[TObjSection.Symbols] = symbolsOffset;        sizes[TObjSection.Symbols] = symbolsBuffer.length;
        offsets[TObjSection.ResFileDir] = emptyDataOffset;   sizes[TObjSection.ResFileDir] = 0;
        offsets[TObjSection.EventDir] = eventDirOffset;      sizes[TObjSection.EventDir] = eventDirBuffer.length;
        offsets[TObjSection.LibFileDir] = emptyDataOffset;   sizes[TObjSection.LibFileDir] = 0;
        offsets[TObjSection.Extra] = extraOffset;            sizes[TObjSection.Extra] = extraBuffer.length;

        const localAllocSize = this.options.localAllocSize ?? 0;
        const mergedFlags = this.flags | (this.options.flags ?? 0);

        const daysSince2000 = Math.floor((now.getTime() - new Date(2000, 0, 1).getTime()) / 86400000);
        const minutesOfDay = now.getHours() * 60 + now.getMinutes();

        const w = new BinaryWriter();
        w.writeDword(TOBJ_SIGNATURE_BIN);
        w.writeWord(TOBJ_VERSION);
        w.writeWord(0); // checksum placeholder
        w.writeDword(fileSize);

        // ALLOC_INFO
        w.writeDword(platformSize);
        w.writeDword(globalAllocSize);
        w.writeDword(stackSize);
        w.writeDword(localAllocSize);

        w.writeDword(mergedFlags);
        w.writeDword(projectNameOff);
        w.writeDword(buildIdOff);
        w.writeDword(firmwareVerOff);

        w.writeWord(daysSince2000 & 0xFFFF);
        w.writeWord(minutesOfDay & 0xFFFF);

        // Section descriptors
        for (let i = 0; i < sectionCount; i++) {
            w.writeDword(offsets[i]);
            w.writeDword(sizes[i]);
        }

        // Section data in layout order
        w.writeBytes(extraBuffer);
        w.writeBytes(eventDirBuffer);
        w.writeBytes(symbolsBuffer);
        w.writeBytes(rdataBuffer);
        w.writeBytes(codeBuffer);

        // Terminator
        w.writeDword(fileSize);
        w.writeDword(TOBJ_SIGNATURE_BIN);

        // Checksum
        const result = w.toBuffer();
        let checksum = 0;
        for (let i = 0; i < result.length; i++) {
            checksum = (checksum + result[i]) & 0xFFFF;
        }
        checksum = (~checksum + 1) & 0xFFFF;
        result[6] = checksum & 0xFF;
        result[7] = (checksum >> 8) & 0xFF;

        return result;
    }

    private emptyHeader(): ObjHeader {
        return {
            signature: 0, version: 0, checksum: 0, fileSize: 0,
            platformSize: 0, globalAllocSize: 0, stackSize: 0, localAllocSize: 0,
            flags: 0, projectName: 0, buildId: 0, firmwareVer: 0,
        };
    }
}

class BinSymbolStringTable {
    private data: number[] = [];
    private offsets = new Map<string, number>();

    add(s: string): number {
        const existing = this.offsets.get(s);
        if (existing !== undefined) return existing;
        const offset = this.data.length;
        for (let i = 0; i < s.length; i++) this.data.push(s.charCodeAt(i));
        this.data.push(0);
        this.offsets.set(s, offset);
        return offset;
    }

    toBuffer(): Buffer { return Buffer.from(this.data); }
}
