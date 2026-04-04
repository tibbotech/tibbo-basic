import {
    TOBJ_SIGNATURE_OBJ, TOBJ_SIGNATURE_PDB, TOBJ_SIGNATURE_BIN, TOBJ_VERSION,
    TObjSection, TObjHeaderFlags, TObjAddressFlags, TObjRefType,
    TObjVariableFlags, TObjFunctionFlags, TObjDataType,
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
    resources?: Array<{ name: string; data: Buffer }>;
    functionOrder?: string[];
    variableAddressOverrides?: Map<string, number>;
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

interface LinkedResourceEntry {
    name: string;
    dataOffset: number;
    size: number;
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
    private resources: LinkedResourceEntry[] = [];
    private flags = 0;
    private cumulativeGlobalAlloc = 0;
    private maxLocalAllocSize = 0;
    private pendingDescriptors: { adjustedOffset: number; data: number[]; refType: number }[] = [];
    private fnSpanByTag = new Map<string, { start: number; end: number }>();
    private importOnlyFnTags = new Set<string>();
    private eventFnTags = new Set<string>();
    private localRelocDeltas = new Map<string, number>();
    private linkAddressAdjustments = new Map<string, number>();

    // Per-OBJ tracking for PDB debug sections
    private allObjSectionData: Buffer[][] = [];
    private pdbCodeBases: number[] = [];
    private pdbInitBases: number[] = [];
    private pdbSymBases: number[] = [];
    private pdbAddrBases: number[] = [];
    private pdbFuncBases: number[] = [];
    private pdbScopeBases: number[] = [];
    private pdbRdataBases: number[] = [];
    private firstObjData: Buffer | null = null;

    constructor(diagnostics: DiagnosticCollection, options: LinkerOptions = {}) {
        this.diagnostics = diagnostics;
        this.options = options;
    }

    link(objBuffers: { name: string; data: Buffer; initObjDescriptors?: { initOffset: number; data: number[]; isInit?: boolean }[] }[]): Buffer {
        this.cumulativeGlobalAlloc = 0;
        this.allObjSectionData = [];
        this.pdbCodeBases = [];
        this.pdbInitBases = [];
        this.pdbSymBases = [];
        this.pdbAddrBases = [];
        this.pdbFuncBases = [];
        this.pdbScopeBases = [];
        this.pdbRdataBases = [];
        this.firstObjData = null;

        const objFiles = objBuffers.map(b => this.loadObj(b.name, b.data));

        let addrCount = 0, funcCount = 0, scopeCount = 0;

        for (let i = 0; i < objFiles.length; i++) {
            const obj = objFiles[i];

            this.pdbCodeBases.push(this.mergedCode.length);
            this.pdbInitBases.push(this.mergedInit.length);
            this.pdbSymBases.push(this.mergedObjSymbols.length);
            this.pdbAddrBases.push(addrCount);
            this.pdbFuncBases.push(funcCount);
            this.pdbScopeBases.push(scopeCount);
            this.pdbRdataBases.push(this.mergedRData.length);

            if (i === 0) this.firstObjData = obj.data;
            this.allObjSectionData.push(obj.sections.map(s => s.data));

            const initBase = this.mergedInit.length;
            const codeBase = this.mergedCode.length;
            this.linkObj(obj);

            const addrBuf = obj.sections[TObjSection.Addresses]?.data ?? Buffer.alloc(0);
            const funcBuf = obj.sections[TObjSection.Functions]?.data ?? Buffer.alloc(0);
            const scopeBuf = obj.sections[TObjSection.Scopes]?.data ?? Buffer.alloc(0);
            addrCount += countAddressEntries(addrBuf);
            funcCount += countFunctionEntries(funcBuf);
            scopeCount += Math.floor(scopeBuf.length / 32);

            const descs = objBuffers[i].initObjDescriptors;
            if (descs) {
                for (const d of descs) {
                    const isInit = d.isInit !== false;
                    this.pendingDescriptors.push({
                        adjustedOffset: d.initOffset + (isInit ? initBase : codeBase),
                        data: d.data,
                        refType: isInit ? TObjRefType.Init : TObjRefType.Code,
                    });
                }
            }
        }

        this.relocateLocals(objFiles);
        for (const [tag, adjustment] of this.linkAddressAdjustments) {
            this.localRelocDeltas.set(
                tag,
                (this.localRelocDeltas.get(tag) ?? 0) + adjustment,
            );
        }
        this.compactUnreferencedFunctions();
        this.reorderFunctions();
        // this.applyVariableAddressOverrides();
        return this.emit();
    }

    private writeOperand(bytes: number[], offset: number, value: number, width: number): void {
        if (offset < 0 || offset + width > bytes.length) return;
        for (let i = 0; i < width; i++) {
            bytes[offset + i] = (value >> (i * 8)) & 0xFF;
        }
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
        const fileDataBase = this.mergedFileData.length;

        const codeData = obj.sections[TObjSection.Code]?.data;
        if (codeData) {
            for (const b of codeData) this.mergedCode.push(b);
        }

        const initData = obj.sections[TObjSection.Init]?.data;
        if (initData) {
            for (const b of initData) this.mergedInit.push(b);
        }

        const rdataData = obj.sections[TObjSection.RData]?.data;
        if (rdataData) {
            for (const b of rdataData) this.mergedRData.push(b);
        }

        const symbolData = obj.sections[TObjSection.Symbols]?.data;
        if (symbolData) {
            for (const b of symbolData) this.mergedObjSymbols.push(b);
        }

        const fileData = obj.sections[TObjSection.FileData]?.data;
        if (fileData) {
            for (const b of fileData) this.mergedFileData.push(b);
        }

        this.linkResFileDir(obj, fileDataBase);

        const varData = obj.sections[TObjSection.Variables]?.data;
        const globalAddrIndices =
            varData && varData.length > 0
                ? this.collectGlobalAddressIndices(varData)
                : new Set<number>();

        const localTagSizes = this.collectLocalAddressSizes(obj);
        this.linkAddresses(obj, codeBase, initBase, globalAddrIndices, localTagSizes);

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

        this.linkFunctions(obj, codeBase);
        this.linkRDataDir(obj, codeBase, initBase, rdataBase);

        this.cumulativeGlobalAlloc += obj.header.globalAllocSize >>> 0;
        if (obj.header.localAllocSize > this.maxLocalAllocSize) {
            this.maxLocalAllocSize = obj.header.localAllocSize;
        }

        const codeAdded = this.mergedCode.length - codeBase;
        if (codeAdded > 0) {
            this.recordFunctionSpansFromObj(obj, codeBase, codeAdded);
        }
    }

    private linkFunctions(obj: ObjFile, codeBase: number): void {
        const funcData = obj.sections[TObjSection.Functions]?.data;
        if (!funcData || funcData.length === 0) return;

        const symbolData = obj.sections[TObjSection.Symbols]?.data;

        let pos = 0;
        while (pos + 17 <= funcData.length) {
            const flags = funcData.readUInt8(pos); pos += 1;
            const nameRef = funcData.readUInt32LE(pos); pos += 4;
            const addrIdx = funcData.readUInt32LE(pos); pos += 4;
            const eventIdx = funcData.readUInt32LE(pos); pos += 4;
            const calleeCount = funcData.readUInt32LE(pos); pos += 4;

            pos += calleeCount * 4;

            if (flags & 1) {
                let fnName = '';
                if (symbolData && nameRef < symbolData.length) {
                    for (let i = nameRef; i < symbolData.length && symbolData[i] !== 0; i++) {
                        fnName += String.fromCharCode(symbolData[i]);
                    }
                }
                this.eventFnTags.add(('?F:' + fnName).toLowerCase());
            }

            if (!(flags & 1)) continue;

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
                    dataAddress: 0,
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

    private linkResFileDir(obj: ObjFile, fileDataBase: number): void {
        const dirData = obj.sections[TObjSection.ResFileDir]?.data;
        const symbolData = obj.sections[TObjSection.Symbols]?.data;
        if (!dirData || dirData.length === 0 || !symbolData) return;

        let pos = 0;
        while (pos + 12 <= dirData.length) {
            const nameOffset = dirData.readUInt32LE(pos); pos += 4;
            const dataOffset = dirData.readUInt32LE(pos); pos += 4;
            const size = dirData.readUInt32LE(pos); pos += 4;

            let name = '';
            for (let i = nameOffset; i < symbolData.length && symbolData[i] !== 0; i++) {
                name += String.fromCharCode(symbolData[i]);
            }

            this.resources.push({
                name,
                dataOffset: fileDataBase + dataOffset,
                size,
            });
        }
    }

    private collectGlobalAddressIndices(varBuf: Buffer): Set<number> {
        const set = new Set<number>();
        let pos = 0;
        while (pos < varBuf.length) {
            if (pos + 14 > varBuf.length) break;
            const flags = varBuf.readUInt8(pos);
            pos += 1;
            pos += 4;
            const addrIdx = varBuf.readUInt32LE(pos);
            pos += 4;
            const ownerScope = varBuf.readUInt32LE(pos);
            pos += 4;
            if (pos + 5 > varBuf.length) break;
            pos += 5;

            const isGlobal = ownerScope === MAXDWORD;
            const isStatic = (flags & TObjVariableFlags.Static) !== 0;
            if (isGlobal || isStatic) {
                set.add(addrIdx);
            }
        }
        return set;
    }

    private collectLocalAddressSizes(obj: ObjFile): Map<string, number> {
        const result = new Map<string, number>();
        const varData = obj.sections[TObjSection.Variables]?.data;
        const typesData = obj.sections[TObjSection.Types]?.data;
        const addrData = obj.sections[TObjSection.Addresses]?.data;
        const symbolData = obj.sections[TObjSection.Symbols]?.data;
        if (!varData || !addrData || !symbolData) return result;

        const useData32 = !!(this.flags & TObjHeaderFlags.Data32);
        const dataAddrSize = useData32 ? 4 : 2;
        const typeSizes = parseTypeSizes(typesData);

        const addrIdxToSize = new Map<number, number>();
        let vpos = 0;
        while (vpos + 18 <= varData.length) {
            const vflags = varData.readUInt8(vpos); vpos += 1;
            vpos += 4;
            const addrIdx = varData.readUInt32LE(vpos); vpos += 4;
            const ownerScope = varData.readUInt32LE(vpos); vpos += 4;
            const dtByte = varData.readUInt8(vpos); vpos += 1;
            const dtDword = varData.readUInt32LE(vpos); vpos += 4;

            if (ownerScope === MAXDWORD) continue;
            if (vflags & TObjVariableFlags.Static) continue;

            const size = getVariableSize(vflags, dtByte, dtDword, typeSizes, dataAddrSize);
            addrIdxToSize.set(addrIdx, size);
        }

        let apos = 0;
        let addrIdx = 0;
        while (apos + 17 <= addrData.length) {
            const flags = addrData.readUInt8(apos); apos += 1;
            const tagOff = addrData.readUInt32LE(apos); apos += 4;
            apos += 4;
            apos += 4;
            const refCount = addrData.readUInt32LE(apos); apos += 4;
            apos += refCount * 5;

            if (!(flags & TObjAddressFlags.Code)) {
                const size = addrIdxToSize.get(addrIdx);
                if (size !== undefined) {
                    let tagName = '';
                    for (let i = tagOff; i < symbolData.length && symbolData[i] !== 0; i++) {
                        tagName += String.fromCharCode(symbolData[i]);
                    }
                    if (tagName) result.set(tagName, size);
                }
            }
            addrIdx++;
        }

        return result;
    }

    private linkAddresses(
        obj: ObjFile,
        codeBase: number,
        initBase: number,
        globalAddrIndices: Set<number>,
        localTagSizes?: Map<string, number>,
    ): void {
        const addrData = obj.sections[TObjSection.Addresses]?.data;
        if (!addrData || addrData.length === 0) return;

        const startIdx = this.addresses.length;
        const globalBase = (this.cumulativeGlobalAlloc >>> 0);
        let pos = 0;
        let addrEntryIndex = 0;
        while (pos < addrData.length) {
            if (pos + 17 > addrData.length) break;

            const flags = addrData.readUInt8(pos); pos += 1;
            const tag = addrData.readUInt32LE(pos); pos += 4;
            let address = addrData.readUInt32LE(pos); pos += 4;
            const baseAddress = addrData.readUInt32LE(pos); pos += 4;
            const refCount = addrData.readUInt32LE(pos); pos += 4;

            if (flags & TObjAddressFlags.Code) {
                if (flags & TObjAddressFlags.Init) {
                    address += initBase;
                } else {
                    address += codeBase;
                }
            } else if (globalAddrIndices.has(addrEntryIndex)) {
                address = (address + globalBase) >>> 0;
            }
            addrEntryIndex += 1;

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

            const tagLc = tagName.toLowerCase();
            if ((tagLc.startsWith('?f:') || tagLc.startsWith('!f:')) && (flags & TObjAddressFlags.Code) && !(flags & TObjAddressFlags.Defined)) {
                this.importOnlyFnTags.add(tagLc);
            }

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

        if (localTagSizes && localTagSizes.size > 0) {
            const scopeGroups = new Map<string, LinkedAddress[]>();
            for (let i = startIdx; i < this.addresses.length; i++) {
                const addr = this.addresses[i];
                if (addr.flags & TObjAddressFlags.Code) continue;
                const fnName = extractFunctionName(addr.tag);
                if (!fnName) continue;
                const fnLc = fnName.toLowerCase();
                if (!scopeGroups.has(fnLc)) scopeGroups.set(fnLc, []);
                scopeGroups.get(fnLc)!.push(addr);
            }

            for (const [, addrs] of scopeGroups) {
                if (addrs.length < 2) continue;
                addrs.sort((a, b) => a.address - b.address);
                for (let i = 1; i < addrs.length; i++) {
                    const prev = addrs[i - 1];
                    const prevSize = localTagSizes.get(prev.tag) ?? 1;
                    const minAddr = prev.address + prevSize;
                    if (addrs[i].address < minAddr) {
                        const adjustment = minAddr - addrs[i].address;
                        addrs[i].address = minAddr;
                        this.linkAddressAdjustments.set(
                            addrs[i].tag,
                            (this.linkAddressAdjustments.get(addrs[i].tag) ?? 0) + adjustment,
                        );
                    }
                }
            }
        }
    }

    private emit(): Buffer {
        // Snapshot merged init before appending the RET terminator;
        // the PDB keeps the raw init payload in TOBJ_SECTION_INIT.
        const initSectionData = this.mergedInit.length > 0
            ? Buffer.from(this.mergedInit)
            : Buffer.alloc(0);

        if (this.mergedInit.length > 0) {
            this.mergedInit.push(0x1F); // OPCODE_RET
        }

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

        // Apply address fixups to code
        const useCode24 = !!(this.flags & TObjHeaderFlags.Code24);
        const useData32 = !!(this.flags & TObjHeaderFlags.Data32);
        const codeAddrSize = useCode24 ? 3 : 2;
        const dataAddrSize = useData32 ? 4 : 2;

        for (const addr of this.addresses) {
            if (!(addr.flags & TObjAddressFlags.Defined)) continue;
            for (const ref of addr.references) {
                const offset = ref.offset;
                if (ref.type === TObjRefType.Code || ref.type === TObjRefType.Init) {
                    const width = (addr.flags & TObjAddressFlags.Code) ? codeAddrSize : dataAddrSize;
                    this.writeOperand(fullCode, offset, addr.address, width);
                }
            }
        }

        // Append type descriptors to RData and track their RDataDir entries
        const descriptorRdataEntries: { rdataOffset: number; size: number; refType: number; codeOffset: number }[] = [];
        for (const desc of this.pendingDescriptors) {
            const rdataTarget = this.mergedRData.length;
            for (const b of desc.data) this.mergedRData.push(b);
            this.rdataRelocs.push({
                codeOffset: desc.adjustedOffset,
                refType: desc.refType,
                rdataTarget,
            });
            descriptorRdataEntries.push({
                rdataOffset: rdataTarget,
                size: desc.data.length,
                refType: desc.refType,
                codeOffset: desc.adjustedOffset,
            });
        }

        // Apply RData relocations
        for (const reloc of this.rdataRelocs) {
            let offset = reloc.codeOffset;
            if (reloc.refType === TObjRefType.Code) {
                offset += initSize;
            }
            this.writeOperand(fullCode, offset, reloc.rdataTarget, 4);
        }

        const codeBuffer = Buffer.from(fullCode);
        const rdataBuffer = Buffer.from(this.mergedRData);

        // Build PDB symbols = concatenated OBJ symbols + option resource names
        let pdbSymbols = Buffer.from(this.mergedObjSymbols);
        const optionResEntries: Buffer[] = [];
        for (const resource of this.options.resources ?? []) {
            const dataOffset = this.mergedFileData.length;
            for (const byte of resource.data) {
                this.mergedFileData.push(byte);
            }
            const nameOffset = pdbSymbols.length;
            const nameBuf = Buffer.alloc(resource.name.length + 1);
            for (let ci = 0; ci < resource.name.length; ci++) nameBuf[ci] = resource.name.charCodeAt(ci);
            nameBuf[resource.name.length] = 0;
            pdbSymbols = Buffer.concat([pdbSymbols, nameBuf]);

            const entryW = new BinaryWriter();
            entryW.writeDword(nameOffset);
            entryW.writeDword(dataOffset);
            entryW.writeDword(resource.data.length);
            optionResEntries.push(entryW.toBuffer());
        }

        // PDB header fields at +32/+36/+40 are symbol-section offsets. OBJ files always write
        // MAXDWORD for firmwareVer in the header (see TOBJ writer), and project buildId is often
        // only known at link time — so copy-from-first-OBJ leaves them unset. Append linker
        // metadata strings to the merged symbol pool when options supply them.
        const firstHdrBuf = this.firstObjData;
        let pdbHdrProjectNameOff = firstHdrBuf ? firstHdrBuf.readUInt32LE(32) : MAXDWORD;
        let pdbHdrBuildIdOff = firstHdrBuf ? firstHdrBuf.readUInt32LE(36) : MAXDWORD;
        let pdbHdrFirmwareVerOff = firstHdrBuf ? firstHdrBuf.readUInt32LE(40) : MAXDWORD;
        const appendPdbSymString = (s: string): number => {
            const off = pdbSymbols.length;
            const nb = Buffer.alloc(s.length + 1);
            for (let i = 0; i < s.length; i++) nb[i] = s.charCodeAt(i) & 0xff;
            nb[s.length] = 0;
            pdbSymbols = Buffer.concat([pdbSymbols, nb]);
            return off;
        };
        if (this.options.projectName) pdbHdrProjectNameOff = appendPdbSymString(this.options.projectName);
        if (this.options.buildId) pdbHdrBuildIdOff = appendPdbSymString(this.options.buildId);
        if (this.options.firmwareVer) pdbHdrFirmwareVerOff = appendPdbSymString(this.options.firmwareVer);

        const fileDataBuffer = Buffer.from(this.mergedFileData);

        // ResFileDir: first OBJ's + option resources
        const firstSections = this.allObjSectionData[0] || [];
        const baseResFileDir = firstSections[TObjSection.ResFileDir] ?? Buffer.alloc(0);
        const resFileDirBuffer = Buffer.concat([baseResFileDir, ...optionResEntries]);

        // EventDir
        const platformSize = this.options.platformSize ?? 0;
        const stackSize = this.options.stackSize ?? 0;
        const computedGlobal = this.cumulativeGlobalAlloc >>> 0;
        const globalAllocSize =
            this.options.globalAllocSize !== undefined
                ? Math.max(this.options.globalAllocSize >>> 0, computedGlobal)
                : computedGlobal;
        const totalDataSize = globalAllocSize + platformSize + stackSize;

        const maxEventNumber = this.options.maxEventNumber ?? 0;
        const eventDirSize = Math.max(this.eventEntryCount, maxEventNumber);

        const eventW = new BinaryWriter();
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

        // Extra: from first OBJ
        const extraBuffer = firstSections[TObjSection.Extra] ?? Buffer.alloc(0);
        // LibFileDir: from first OBJ
        const libFileDirBuffer = firstSections[TObjSection.LibFileDir] ?? Buffer.alloc(0);

        // --- PDB debug sections (9-19) ---
        const allSec = this.allObjSectionData;

        const pdbAddresses = this.pdbMergeAddresses(allSec, this.pdbCodeBases, this.pdbInitBases, this.pdbSymBases, initSize);
        const pdbFunctions = this.pdbMergeFunctions(allSec, this.pdbSymBases, this.pdbAddrBases, this.pdbFuncBases);
        const pdbScopes = this.pdbMergeScopes(allSec, this.pdbCodeBases, this.pdbSymBases, initSize);
        const pdbVariables = this.pdbMergeVariables(allSec, this.pdbSymBases, this.pdbAddrBases, this.pdbScopeBases);
        const pdbLineInfo = this.pdbMergeLineInfo(allSec, this.pdbCodeBases, this.pdbSymBases, initSize);

        const objRdataDir = this.pdbMergeRDataDir(allSec, this.pdbCodeBases, this.pdbInitBases, this.pdbRdataBases);
        const descRdataDirW = new BinaryWriter();
        for (const entry of descriptorRdataEntries) {
            descRdataDirW.writeDword(entry.rdataOffset);
            descRdataDirW.writeDword(entry.size);
            descRdataDirW.writeDword(1);
            descRdataDirW.writeByte(entry.refType);
            let from = entry.codeOffset;
            if (entry.refType === TObjRefType.Code) from += initSize;
            descRdataDirW.writeDword(from);
        }
        const pdbRdataDir = Buffer.concat([objRdataDir, descRdataDirW.toBuffer()]);

        const objectsSection = firstSections[TObjSection.Objects] ?? Buffer.alloc(0);
        const syscallsSection = firstSections[TObjSection.Syscalls] ?? Buffer.alloc(0);
        const typesSection = firstSections[TObjSection.Types] ?? Buffer.alloc(0);
        const libNameDirSection = firstSections[TObjSection.LibNameDir] ?? Buffer.alloc(0);
        const incNameDirSection = firstSections[TObjSection.IncNameDir] ?? Buffer.alloc(0);

        // Assemble all 20 sections
        const sectionCount = TObjSection.CountObj;
        const sectionData: Buffer[] = new Array(sectionCount).fill(Buffer.alloc(0));
        sectionData[TObjSection.Code] = codeBuffer;
        sectionData[TObjSection.Init] = initSectionData;
        sectionData[TObjSection.RData] = rdataBuffer;
        sectionData[TObjSection.FileData] = fileDataBuffer;
        sectionData[TObjSection.Symbols] = pdbSymbols;
        sectionData[TObjSection.ResFileDir] = resFileDirBuffer;
        sectionData[TObjSection.EventDir] = eventDirBuffer;
        sectionData[TObjSection.LibFileDir] = libFileDirBuffer;
        sectionData[TObjSection.Extra] = extraBuffer;
        sectionData[TObjSection.Addresses] = pdbAddresses;
        sectionData[TObjSection.Functions] = pdbFunctions;
        sectionData[TObjSection.Scopes] = pdbScopes;
        sectionData[TObjSection.Variables] = pdbVariables;
        sectionData[TObjSection.Objects] = objectsSection;
        sectionData[TObjSection.Syscalls] = syscallsSection;
        sectionData[TObjSection.Types] = typesSection;
        sectionData[TObjSection.RDataDir] = pdbRdataDir;
        sectionData[TObjSection.LineInfo] = pdbLineInfo;
        sectionData[TObjSection.LibNameDir] = libNameDirSection;
        sectionData[TObjSection.IncNameDir] = incNameDirSection;

        const sectionOrder = [
            TObjSection.Extra, TObjSection.EventDir, TObjSection.Symbols,
            TObjSection.ResFileDir, TObjSection.LibFileDir, TObjSection.FileData,
            TObjSection.RData, TObjSection.Code, TObjSection.Init,
            TObjSection.Addresses, TObjSection.Functions, TObjSection.Scopes,
            TObjSection.Variables, TObjSection.Objects, TObjSection.Syscalls,
            TObjSection.Types, TObjSection.RDataDir, TObjSection.LineInfo,
            TObjSection.LibNameDir, TObjSection.IncNameDir,
        ];

        const headerAndDescSize = HEADER_SIZE + sectionCount * SECTION_DESCRIPTOR_SIZE;
        let currentOffset = headerAndDescSize;
        const offsets: number[] = new Array(sectionCount).fill(0);

        for (const idx of sectionOrder) {
            offsets[idx] = currentOffset;
            currentOffset += sectionData[idx].length;
        }

        const fileSize = currentOffset;
        const localAllocSize = this.options.localAllocSize ?? this.maxLocalAllocSize;
        const mergedFlags = this.flags | (this.options.flags ?? 0);

        const now = this.options.fixedTimestamp ?? new Date();
        const daysSince2000 = Math.floor((now.getTime() - new Date(2000, 0, 1).getTime()) / 86400000);
        const minutesOfDay = now.getHours() * 60 + now.getMinutes();

        const w = new BinaryWriter();
        w.writeDword(TOBJ_SIGNATURE_PDB);
        w.writeWord(TOBJ_VERSION);
        w.writeWord(0); // checksum placeholder
        w.writeDword(fileSize);

        w.writeDword(platformSize);
        w.writeDword(globalAllocSize);
        w.writeDword(stackSize);
        w.writeDword(localAllocSize);

        w.writeDword(mergedFlags);
        w.writeDword(pdbHdrProjectNameOff);
        w.writeDword(pdbHdrBuildIdOff);
        w.writeDword(pdbHdrFirmwareVerOff);
        w.writeWord(daysSince2000 & 0xFFFF);
        w.writeWord(minutesOfDay & 0xFFFF);

        for (let i = 0; i < sectionCount; i++) {
            w.writeDword(offsets[i]);
            w.writeDword(sectionData[i].length);
        }

        for (const idx of sectionOrder) {
            w.writeBytes(sectionData[idx]);
        }

        const result = w.toBuffer();
        let checksum = 0;
        for (let i = 0; i + 1 < result.length; i += 2) {
            checksum = (checksum + result.readUInt16LE(i)) & 0xFFFF;
        }
        if (result.length % 2 !== 0) {
            checksum = (checksum + result[result.length - 1]) & 0xFFFF;
        }
        checksum = (~checksum + 1) & 0xFFFF;
        result[6] = checksum & 0xFF;
        result[7] = (checksum >> 8) & 0xFF;

        return result;
    }

    // ---- Local variable relocation (matching C++ RelocateLocals) ----

    private relocateLocals(objFiles: ObjFile[]): void {
        // 1. Build cross-module call graph from Functions sections
        interface FnEntry {
            name: string;
            isEvent: boolean;
            calleeNames: string[];
        }
        const callGraph = new Map<string, FnEntry>();

        for (const obj of objFiles) {
            const funcData = obj.sections[TObjSection.Functions]?.data;
            const symData = obj.sections[TObjSection.Symbols]?.data;
            if (!funcData || !symData || funcData.length === 0) continue;

            const readSym = (off: number): string => {
                let s = '';
                for (let i = off; i < symData.length && symData[i] !== 0; i++) {
                    s += String.fromCharCode(symData[i]);
                }
                return s;
            };

            const perObjFns: { name: string; flags: number; calleeIndices: number[] }[] = [];
            let pos = 0;
            while (pos + 17 <= funcData.length) {
                const flags = funcData.readUInt8(pos); pos += 1;
                const nameRef = funcData.readUInt32LE(pos); pos += 4;
                pos += 4; // addrIdx
                pos += 4; // eventIdx
                const calleeCount = funcData.readUInt32LE(pos); pos += 4;
                const calleeIndices: number[] = [];
                for (let c = 0; c < calleeCount; c++) {
                    if (pos + 4 > funcData.length) break;
                    calleeIndices.push(funcData.readUInt32LE(pos));
                    pos += 4;
                }
                perObjFns.push({ name: readSym(nameRef), flags, calleeIndices });
            }

            for (const fn of perObjFns) {
                const nameLc = fn.name.toLowerCase();
                const calleeNames = fn.calleeIndices
                    .filter(idx => idx < perObjFns.length)
                    .map(idx => perObjFns[idx].name.toLowerCase());

                const existing = callGraph.get(nameLc);
                if (existing) {
                    if (fn.flags & TObjFunctionFlags.Event) existing.isEvent = true;
                    for (const c of calleeNames) {
                        if (!existing.calleeNames.includes(c)) existing.calleeNames.push(c);
                    }
                } else {
                    callGraph.set(nameLc, {
                        name: nameLc,
                        isEvent: !!(fn.flags & TObjFunctionFlags.Event),
                        calleeNames,
                    });
                }
            }
        }

        if (callGraph.size === 0) return;

        // 2. Build per-OBJ address-index-to-size map from Variables + Types sections
        const addrIndexToSize = new Map<number, number>();
        const useData32 = !!(this.flags & TObjHeaderFlags.Data32);
        const dataAddrSize = useData32 ? 4 : 2;
        let globalAddrOffset = 0;
        const variableNameToSize: any[] = [];

        for (const obj of objFiles) {
            const varData = obj.sections[TObjSection.Variables]?.data;
            const typesData = obj.sections[TObjSection.Types]?.data;

            const typeSizes = parseTypeSizes(typesData);

            const pdb = obj.data;
            const readSectionBuf = (idx: number): Buffer => {
                const descOff = HEADER_SIZE + idx * SECTION_DESCRIPTOR_SIZE;
                if (descOff + 8 > pdb.length) return Buffer.alloc(0);
                const offset = pdb.readUInt32LE(descOff);
                const size = pdb.readUInt32LE(descOff + 4);
                return (offset + size <= pdb.length) ? pdb.slice(offset, offset + size) : Buffer.alloc(0);
            };

            const symData = readSectionBuf(TObjSection.Symbols);
            const addrData = readSectionBuf(TObjSection.Addresses);

            const readSym = (off: number): string => {
                if (off >= symData.length) return '';
                let s = '';
                for (let i = off; i < symData.length && symData[i] !== 0; i++) {
                    s += String.fromCharCode(symData[i]);
                }
                return s;
            };

            const getAddrEntry = (index: number): { tag: string; address: number } | undefined => {
                let apos = 0;
                for (let i = 0; i < index; i++) {
                    if (apos + 17 > addrData.length) return undefined;
                    apos += 13;
                    const refCount = addrData.readUInt32LE(apos); apos += 4;
                    apos += refCount * 5;
                }
                if (apos + 17 > addrData.length) return undefined;
                apos += 1; // flags
                const tagOff = addrData.readUInt32LE(apos); apos += 4;
                const address = addrData.readUInt32LE(apos);
                return { tag: readSym(tagOff), address };
            };

            if (varData && varData.length > 0) {
                let vpos = 0;
                while (vpos + 18 <= varData.length) {
                    const vflags = varData.readUInt8(vpos); vpos += 1;
                    vpos += 4; // name
                    const addrIdx = varData.readUInt32LE(vpos); vpos += 4;
                    const ownerScope = varData.readUInt32LE(vpos); vpos += 4;
                    const dtByte = varData.readUInt8(vpos); vpos += 1;
                    const dtDword = varData.readUInt32LE(vpos); vpos += 4;

                    if (ownerScope === MAXDWORD) continue; // global
                    if (vflags & TObjVariableFlags.Static) continue;

                    const size = getVariableSize(vflags, dtByte, dtDword, typeSizes, dataAddrSize);
                    addrIndexToSize.set(globalAddrOffset + addrIdx, size);

                    const entry = getAddrEntry(addrIdx);
                    if (entry) {
                        variableNameToSize.push({
                            size,
                            tag: entry.tag,
                            address: entry.address,
                        });
                    }
                }
            }

            const addrBuf = obj.sections[TObjSection.Addresses]?.data ?? Buffer.alloc(0);
            globalAddrOffset += countAddressEntries(addrBuf);
        }

        // 3. Associate addresses with functions and compute frame info
        const fnAddresses = new Map<string, LinkedAddress[]>();

        for (const addr of this.addresses) {
            if (addr.flags & TObjAddressFlags.Code) continue;
            const fnName = extractFunctionName(addr.tag);
            if (!fnName) continue;
            const fnLc = fnName.toLowerCase();
            if (!fnAddresses.has(fnLc)) fnAddresses.set(fnLc, []);
            fnAddresses.get(fnLc)!.push(addr);
        }

        // Compute variable sizes by matching address values to the addr-index-to-size map
        const addrToSize = new Map<LinkedAddress, number>();
        let globalIdx = 0;
        for (const obj of objFiles) {
            const addrData = obj.sections[TObjSection.Addresses]?.data;
            if (!addrData || addrData.length === 0) {
                continue;
            }
            const symData = obj.sections[TObjSection.Symbols]?.data;
            let apos = 0;
            while (apos + 17 <= addrData.length) {
                const aflags = addrData.readUInt8(apos); apos += 1;
                const tagOff = addrData.readUInt32LE(apos); apos += 4;
                apos += 4; // address
                apos += 4; // base
                const refCount = addrData.readUInt32LE(apos); apos += 4;
                apos += refCount * 5;

                const size = addrIndexToSize.get(globalIdx);
                if (size !== undefined) {
                    let tagName = '';
                    if (symData && tagOff < symData.length) {
                        for (let si = tagOff; si < symData.length && symData[si] !== 0; si++) {
                            tagName += String.fromCharCode(symData[si]);
                        }
                    }
                    if (tagName) {
                        const matched = this.addresses.find(a => a.tag === tagName);
                        if (matched) addrToSize.set(matched, size);
                    }
                }
                globalIdx++;
            }
        }

        interface FrameInfo { base: number; size: number }
        const frameInfoMap = new Map<string, FrameInfo>();

        for (const [fnLc, addrs] of fnAddresses) {
            if (addrs.length === 0) continue;
            let minAddr = Number.MAX_SAFE_INTEGER;
            let maxEnd = 0;
            for (const addr of addrs) {
                if (addr.address < minAddr) minAddr = addr.address;
                const varSize = addrToSize.get(addr) ?? 1;
                const end = addr.address + varSize;
                if (end > maxEnd) maxEnd = end;
            }
            if (minAddr < Number.MAX_SAFE_INTEGER) {
                frameInfoMap.set(fnLc, { base: minAddr, size: maxEnd - minAddr });
            }
        }

        // 4. Walk call graph from all functions, relocating callees
        this.localRelocDeltas.clear();
        const computedLocalBase = (this.options.platformSize ?? 0) +
            Math.max(this.cumulativeGlobalAlloc >>> 0, this.options.globalAllocSize ?? 0) +
            (this.options.stackSize ?? 0);

        const relocateFunction = (fnLc: string, requestedBase: number): number => {
            const frame = frameInfoMap.get(fnLc);
            if (!frame || frame.size === 0) {
                const entry = callGraph.get(fnLc);
                if (!entry) return 0;
                let result = requestedBase;
                for (const callee of entry.calleeNames) {
                    const r = relocateFunction(callee, requestedBase);
                    if (r > result) result = r;
                }
                return result;
            }

            if (requestedBase > frame.base) {
                const delta = requestedBase - frame.base;
                const addrs = fnAddresses.get(fnLc);
                if (addrs) {
                    for (const addr of addrs) {
                        addr.address += delta;
                        this.localRelocDeltas.set(addr.tag, (this.localRelocDeltas.get(addr.tag) ?? 0) + delta);
                    }
                }
                frame.base = requestedBase;
            }

            const frameEnd = frame.base + frame.size;
            let result = frameEnd;

            const entry = callGraph.get(fnLc);
            if (entry) {
                for (const callee of entry.calleeNames) {
                    const r = relocateFunction(callee, frameEnd);
                    if (r > result) result = r;
                }
            }

            return result;
        };

        let maxLocalEnd = computedLocalBase;
        for (const [fnLc, entry] of callGraph) {
            if (entry.isEvent || !(callGraph.get(fnLc)?.isEvent === false)) {
                // Process all non-doevents functions starting from localBase
            }
            const r = relocateFunction(fnLc, computedLocalBase);
            if (r > maxLocalEnd) maxLocalEnd = r;
        }

        // 5. Update localAllocSize
        const newLocalAllocSize = maxLocalEnd - computedLocalBase;
        if (newLocalAllocSize > this.maxLocalAllocSize) {
            this.maxLocalAllocSize = newLocalAllocSize;
        }
    }

    private emptyHeader(): ObjHeader {
        return {
            signature: 0, version: 0, checksum: 0, fileSize: 0,
            platformSize: 0, globalAllocSize: 0, stackSize: 0, localAllocSize: 0,
            flags: 0, projectName: 0, buildId: 0, firmwareVer: 0,
        };
    }

    // ---- PDB debug section merge methods (ported from ProjectCompiler) ----

    private pdbMergeAddresses(allSections: Buffer[][], codeBases: number[], initBases: number[], symBases: number[], initOffset: number): Buffer {
        const w = new BinaryWriter();
        const linkedByTag = new Map<string, LinkedAddress>();
        for (const a of this.addresses) {
            if (a.tag) linkedByTag.set(a.tag, a);
        }
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.Addresses];
            if (!data || data.length === 0) continue;
            const symData = allSections[i][TObjSection.Symbols];
            const cb = codeBases[i], ib = initBases[i], sb = symBases[i];
            let pos = 0;
            while (pos + 17 <= data.length) {
                const flags = data.readUInt8(pos); pos += 1;
                let tag = data.readUInt32LE(pos); pos += 4;
                let addr = data.readUInt32LE(pos); pos += 4;
                const base = data.readUInt32LE(pos); pos += 4;
                const refCount = data.readUInt32LE(pos); pos += 4;

                let tagName = '';
                if (symData) {
                    for (let si = tag; si < symData.length && symData[si] !== 0; si++) {
                        tagName += String.fromCharCode(symData[si]);
                    }
                }
                const linked = tagName ? linkedByTag.get(tagName) : undefined;
                if (linked) {
                    addr = linked.address;
                } else if (flags & TObjAddressFlags.Code) {
                    if (flags & TObjAddressFlags.Init) {
                        addr += ib;
                    } else {
                        addr += cb + initOffset;
                    }
                } else if (this.localRelocDeltas.size > 0 && symData) {
                    const delta = this.localRelocDeltas.get(tagName);
                    if (delta) addr += delta;
                }
                tag += sb;

                w.writeByte(flags);
                w.writeDword(tag);
                w.writeDword(addr);
                w.writeDword(base);
                w.writeDword(refCount);

                for (let r = 0; r < refCount; r++) {
                    if (pos + 5 > data.length) break;
                    const rt = data.readUInt8(pos); pos += 1;
                    let ro = data.readUInt32LE(pos); pos += 4;
                    if (rt === TObjRefType.Code) ro += cb + initOffset;
                    else if (rt === TObjRefType.Init) ro += ib;
                    w.writeByte(rt);
                    w.writeDword(ro);
                }
            }
        }
        return w.toBuffer();
    }

    private pdbMergeFunctions(allSections: Buffer[][], symBases: number[], addrBases: number[], funcBases: number[]): Buffer {
        const w = new BinaryWriter();
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.Functions];
            if (!data || data.length === 0) continue;
            const sb = symBases[i], ab = addrBases[i], fb = funcBases[i];
            let pos = 0;
            while (pos + 17 <= data.length) {
                const flags = data.readUInt8(pos); pos += 1;
                let name = data.readUInt32LE(pos); pos += 4;
                let addrIdx = data.readUInt32LE(pos); pos += 4;
                const eventIdx = data.readUInt32LE(pos); pos += 4;
                const calleeCount = data.readUInt32LE(pos); pos += 4;

                name += sb;
                addrIdx += ab;

                w.writeByte(flags);
                w.writeDword(name);
                w.writeDword(addrIdx);
                w.writeDword(eventIdx);
                w.writeDword(calleeCount);

                for (let c = 0; c < calleeCount; c++) {
                    if (pos + 4 > data.length) break;
                    let ci = data.readUInt32LE(pos); pos += 4;
                    ci += fb;
                    w.writeDword(ci);
                }
            }
        }
        return w.toBuffer();
    }

    private pdbMergeScopes(allSections: Buffer[][], codeBases: number[], symBases: number[], initOffset: number): Buffer {
        const w = new BinaryWriter();
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.Scopes];
            if (!data || data.length === 0) continue;
            const cb = codeBases[i], sb = symBases[i];
            let pos = 0;
            while (pos + 32 <= data.length) {
                w.writeDword(data.readUInt32LE(pos) + sb); pos += 4;
                w.writeDword(data.readUInt32LE(pos)); pos += 4;
                w.writeDword(data.readUInt32LE(pos)); pos += 4;
                w.writeDword(data.readUInt32LE(pos) + cb + initOffset); pos += 4;
                w.writeDword(data.readUInt32LE(pos) + sb); pos += 4;
                w.writeDword(data.readUInt32LE(pos)); pos += 4;
                w.writeDword(data.readUInt32LE(pos)); pos += 4;
                w.writeDword(data.readUInt32LE(pos) + cb + initOffset); pos += 4;
            }
        }
        return w.toBuffer();
    }

    private pdbMergeVariables(allSections: Buffer[][], symBases: number[], addrBases: number[], scopeBases: number[]): Buffer {
        const w = new BinaryWriter();
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.Variables];
            if (!data || data.length === 0) continue;
            const sb = symBases[i], ab = addrBases[i], scb = scopeBases[i];
            let pos = 0;
            while (pos + 18 <= data.length) {
                const flags = data.readUInt8(pos); pos += 1;
                let name = data.readUInt32LE(pos); pos += 4;
                let addrIdx = data.readUInt32LE(pos); pos += 4;
                let scopeIdx = data.readUInt32LE(pos); pos += 4;
                const dtByte = data.readUInt8(pos); pos += 1;
                const dtDword = data.readUInt32LE(pos); pos += 4;

                name += sb;
                addrIdx += ab;
                if (scopeIdx !== MAXDWORD) scopeIdx += scb;

                w.writeByte(flags);
                w.writeDword(name);
                w.writeDword(addrIdx);
                w.writeDword(scopeIdx);
                w.writeByte(dtByte);
                w.writeDword(dtDword);
            }
        }
        return w.toBuffer();
    }

    private pdbMergeLineInfo(allSections: Buffer[][], codeBases: number[], symBases: number[], initOffset: number): Buffer {
        const w = new BinaryWriter();
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.LineInfo];
            if (!data || data.length === 0) continue;
            const cb = codeBases[i], sb = symBases[i];
            let pos = 0;
            while (pos + 8 <= data.length) {
                let fp = data.readUInt32LE(pos); pos += 4;
                const count = data.readUInt32LE(pos); pos += 4;
                fp += sb;
                w.writeDword(fp);
                w.writeDword(count);
                for (let e = 0; e < count; e++) {
                    if (pos + 8 > data.length) break;
                    const line = data.readUInt32LE(pos); pos += 4;
                    let addr = data.readUInt32LE(pos); pos += 4;
                    addr += cb + initOffset;
                    w.writeDword(line);
                    w.writeDword(addr);
                }
            }
        }
        return w.toBuffer();
    }

    private pdbMergeRDataDir(allSections: Buffer[][], codeBases: number[], initBases: number[], rdataBases: number[]): Buffer {
        const w = new BinaryWriter();
        for (let i = 0; i < allSections.length; i++) {
            const data = allSections[i][TObjSection.RDataDir];
            if (!data || data.length === 0) continue;
            const cb = codeBases[i], ib = initBases[i], rb = rdataBases[i];
            let pos = 0;
            while (pos + 12 <= data.length) {
                let rdOff = data.readUInt32LE(pos); pos += 4;
                const rdSize = data.readUInt32LE(pos); pos += 4;
                const refCount = data.readUInt32LE(pos); pos += 4;
                rdOff += rb;
                w.writeDword(rdOff);
                w.writeDword(rdSize);
                w.writeDword(refCount);
                for (let r = 0; r < refCount; r++) {
                    if (pos + 5 > data.length) break;
                    const rt = data.readUInt8(pos); pos += 1;
                    let ro = data.readUInt32LE(pos); pos += 4;
                    if (rt === TObjRefType.Code) ro += cb;
                    else if (rt === TObjRefType.Init) ro += ib;
                    w.writeByte(rt);
                    w.writeDword(ro);
                }
            }
        }
        return w.toBuffer();
    }

    // ---- Dead code elimination helpers ----

    private recordFunctionSpansFromObj(obj: ObjFile, codeBase: number, codeLen: number): void {
        const addrData = obj.sections[TObjSection.Addresses]?.data;
        const symbolSection = obj.sections[TObjSection.Symbols]?.data;
        if (!addrData || !symbolSection) return;

        const ents: { tagKey: string; off: number }[] = [];
        let pos = 0;
        while (pos < addrData.length) {
            if (pos + 17 > addrData.length) break;
            const flags = addrData.readUInt8(pos); pos += 1;
            const tagOff = addrData.readUInt32LE(pos); pos += 4;
            const address = addrData.readUInt32LE(pos); pos += 4;
            pos += 4;
            const refCount = addrData.readUInt32LE(pos); pos += 4;

            for (let i = 0; i < refCount; i++) {
                if (pos + 5 > addrData.length) break;
                pos += 5;
            }

            if (!(flags & TObjAddressFlags.Code) || !(flags & TObjAddressFlags.Defined)) continue;

            let tname = '';
            if (tagOff < symbolSection.length) {
                for (let i = tagOff; i < symbolSection.length && symbolSection[i] !== 0; i++) {
                    tname += String.fromCharCode(symbolSection[i]);
                }
            }
            const tagKey = tname.toLowerCase();
            if (!tagKey.startsWith('?f:') && !tagKey.startsWith('!f:')) continue;
            if (address >= codeLen) continue;

            ents.push({ tagKey, off: address });
        }

        ents.sort((a, b) => a.off - b.off);
        for (let i = 0; i < ents.length; i++) {
            const endOff = i + 1 < ents.length ? ents[i + 1].off : codeLen;
            this.fnSpanByTag.set(ents[i].tagKey, {
                start: codeBase + ents[i].off,
                end: codeBase + endOff,
            });
        }
    }

    private mergeHalfOpenIntervals(intervals: [number, number][]): [number, number][] {
        if (intervals.length === 0) return [];
        const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
        const out: [number, number][] = [];
        let cs = sorted[0][0];
        let ce = sorted[0][1];
        for (let i = 1; i < sorted.length; i++) {
            const [s, e] = sorted[i];
            if (s <= ce) {
                ce = Math.max(ce, e);
            } else {
                out.push([cs, ce]);
                cs = s;
                ce = e;
            }
        }
        out.push([cs, ce]);
        return out;
    }

    private applyVariableAddressOverrides(): void {
        const overrides = this.options.variableAddressOverrides;
        if (!overrides || overrides.size === 0) return;

        for (const addr of this.addresses) {
            if (addr.flags & TObjAddressFlags.Code) continue;
            if (!(addr.flags & TObjAddressFlags.Defined)) continue;
            const overrideAddr = overrides.get(addr.tag);
            if (overrideAddr !== undefined) {
                addr.address = overrideAddr;
            }
        }
    }

    private reorderFunctions(): void {
        const targetOrder = this.options.functionOrder;
        if (!targetOrder || targetOrder.length === 0) return;
        if (this.fnSpanByTag.size === 0) return;

        const spans = [...this.fnSpanByTag.entries()]
            .map(([tag, span]) => ({ tag, ...span }))
            .sort((a, b) => a.start - b.start);

        const orderIndex = new Map<string, number>();
        for (let i = 0; i < targetOrder.length; i++) {
            orderIndex.set(targetOrder[i], i);
        }

        const reordered = [...spans].sort((a, b) => {
            const ai = orderIndex.get(a.tag) ?? Number.MAX_SAFE_INTEGER;
            const bi = orderIndex.get(b.tag) ?? Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
            return a.start - b.start;
        });

        let changed = false;
        for (let i = 0; i < spans.length; i++) {
            if (spans[i].tag !== reordered[i].tag) { changed = true; break; }
        }
        if (!changed) return;

        const extractedBlocks: { tag: string; data: number[]; oldStart: number; oldEnd: number }[] = [];
        for (const sp of reordered) {
            extractedBlocks.push({
                tag: sp.tag,
                data: this.mergedCode.slice(sp.start, sp.end),
                oldStart: sp.start,
                oldEnd: sp.end,
            });
        }

        const codeStart = spans[0].start;
        const codeEnd = spans[spans.length - 1].end;

        const oldToNew = new Map<number, number>();
        let cursor = codeStart;
        for (const block of extractedBlocks) {
            oldToNew.set(block.oldStart, cursor);
            cursor += block.data.length;
        }

        const remapCodeOffset = (offset: number): number => {
            for (const block of extractedBlocks) {
                const newStart = oldToNew.get(block.oldStart)!;
                if (offset >= block.oldStart && offset < block.oldEnd) {
                    return newStart + (offset - block.oldStart);
                }
            }
            return offset;
        };

        const newCode = new Array(this.mergedCode.length);
        for (let i = 0; i < codeStart; i++) newCode[i] = this.mergedCode[i];
        cursor = codeStart;
        for (const block of extractedBlocks) {
            for (let j = 0; j < block.data.length; j++) {
                newCode[cursor + j] = block.data[j];
            }
            cursor += block.data.length;
        }
        for (let i = codeEnd; i < this.mergedCode.length; i++) newCode[i] = this.mergedCode[i];
        this.mergedCode = newCode;

        for (const addr of this.addresses) {
            if (addr.flags & TObjAddressFlags.Code) {
                addr.address = remapCodeOffset(addr.address);
            }
            for (const ref of addr.references) {
                if (ref.type === TObjRefType.Code) {
                    ref.offset = remapCodeOffset(ref.offset);
                }
            }
        }

        for (let i = 0; i < this.eventEntries.length; i++) {
            const en = this.eventEntries[i];
            if (en) {
                en.codeAddress = remapCodeOffset(en.codeAddress);
            }
        }

        for (const reloc of this.rdataRelocs) {
            if (reloc.refType === TObjRefType.Code) {
                reloc.codeOffset = remapCodeOffset(reloc.codeOffset);
            }
        }

        for (const desc of this.pendingDescriptors) {
            if (desc.refType === TObjRefType.Code) {
                desc.adjustedOffset = remapCodeOffset(desc.adjustedOffset);
            }
        }

        this.fnSpanByTag.clear();
        for (const block of extractedBlocks) {
            const newStart = oldToNew.get(block.oldStart)!;
            this.fnSpanByTag.set(block.tag, {
                start: newStart,
                end: newStart + block.data.length,
            });
        }
    }

    private compactUnreferencedFunctions(): void {
        const deadTagKeys = new Set<string>();
        for (const addr of this.addresses) {
            const t = addr.tag.toLowerCase();
            if (!t.startsWith('!f:')) continue;
            if (!(addr.flags & TObjAddressFlags.Code)) continue;
            if (!(addr.flags & TObjAddressFlags.Defined)) continue;
            if (addr.references.length > 0) continue;
            if (this.eventFnTags.has(t)) continue;
            if (this.importOnlyFnTags.has(t)) continue;
            deadTagKeys.add(t);
        }
        if (deadTagKeys.size === 0) return;

        const intervals: [number, number][] = [];
        for (const key of deadTagKeys) {
            const sp = this.fnSpanByTag.get(key);
            if (!sp || sp.end <= sp.start) continue;
            intervals.push([sp.start, sp.end]);
        }
        if (intervals.length === 0) return;

        const merged = this.mergeHalfOpenIntervals(intervals);
        const bytesRemovedBefore = (p: number): number => {
            let sum = 0;
            for (const [s, e] of merged) {
                if (e <= p) sum += e - s;
            }
            return sum;
        };
        const adjustCode = (p: number): number => p - bytesRemovedBefore(p);

        for (let i = merged.length - 1; i >= 0; i--) {
            const [s, e] = merged[i];
            this.mergedCode.splice(s, e - s);
        }

        for (const addr of this.addresses) {
            if (addr.flags & TObjAddressFlags.Code) {
                addr.address = adjustCode(addr.address);
            }
            for (const ref of addr.references) {
                if (ref.type === TObjRefType.Code) {
                    ref.offset = adjustCode(ref.offset);
                }
            }
        }

        this.addresses = this.addresses.filter(a => !deadTagKeys.has(a.tag.toLowerCase()));

        for (let i = 0; i < this.eventEntries.length; i++) {
            const en = this.eventEntries[i];
            if (en) {
                en.codeAddress = adjustCode(en.codeAddress);
            }
        }

        for (const reloc of this.rdataRelocs) {
            if (reloc.refType === TObjRefType.Code) {
                reloc.codeOffset = adjustCode(reloc.codeOffset);
            }
        }

        for (const desc of this.pendingDescriptors) {
            if (desc.refType === TObjRefType.Code) {
                desc.adjustedOffset = adjustCode(desc.adjustedOffset);
            }
        }
    }
}

function countAddressEntries(data: Buffer): number {
    let pos = 0, count = 0;
    while (pos + 17 <= data.length) {
        pos += 13;
        const refCount = data.readUInt32LE(pos); pos += 4;
        pos += refCount * 5;
        count++;
    }
    return count;
}

function countFunctionEntries(data: Buffer): number {
    let pos = 0, count = 0;
    while (pos + 17 <= data.length) {
        pos += 13;
        const calleeCount = data.readUInt32LE(pos); pos += 4;
        pos += calleeCount * 4;
        count++;
    }
    return count;
}

function extractFunctionName(tag: string): string | null {
    if (tag.startsWith('!V:')) {
        const rest = tag.substring(3);
        const colonIdx = rest.indexOf(':');
        return colonIdx >= 0 ? rest.substring(0, colonIdx) : null;
    }
    if (tag.startsWith('?A:')) {
        const rest = tag.substring(3);
        const colonIdx = rest.indexOf(':');
        return colonIdx >= 0 ? rest.substring(0, colonIdx) : null;
    }
    const localMatch = tag.match(/:local\(([^:)]+)/);
    if (localMatch) return localMatch[1];
    return null;
}

function getVariableSize(
    flags: number, dtByte: number, dtDword: number,
    typeSizes: Map<number, number>, dataAddrSize: number,
): number {
    if (flags & TObjVariableFlags.ByRef) return dataAddrSize;
    switch (dtByte) {
        case TObjDataType.Boolean:
        case TObjDataType.Byte:
        case TObjDataType.Char:
            return 1;
        case TObjDataType.Word:
        case TObjDataType.Short:
            return 2;
        case TObjDataType.Dword:
        case TObjDataType.Long:
        case TObjDataType.Real:
            return 4;
        case TObjDataType.String:
            return (dtDword & 0xFF) + 1;
        case TObjDataType.Array:
        case TObjDataType.Struct:
        case TObjDataType.StructC:
        case TObjDataType.Enum:
        case TObjDataType.Union:
            return typeSizes.get(dtDword) ?? 2;
        default:
            return 2;
    }
}

function parseTypeSizes(typesData: Buffer | undefined): Map<number, number> {
    const sizes = new Map<number, number>();
    if (!typesData || typesData.length === 0) return sizes;

    let pos = 0;
    let idx = 0;
    while (pos + 17 <= typesData.length) {
        const dtType = typesData.readUInt8(pos);
        // name at pos+1 (4 bytes), size at pos+5 (4 bytes)
        const size = typesData.readUInt32LE(pos + 5);
        const elemCount = typesData.readUInt32LE(pos + 9);
        const refCount = typesData.readUInt32LE(pos + 13);
        sizes.set(idx, size);
        pos += 17;

        switch (dtType) {
            case TObjDataType.Array:
            case TObjDataType.ArrayC:
            case TObjDataType.Pointer:
            case TObjDataType.Reference:
                pos += 5; // element data type
                pos += refCount * 5;
                break;
            case TObjDataType.Enum:
                pos += 1; // base type
                pos += elemCount * 8;
                break;
            case TObjDataType.Struct:
            case TObjDataType.StructC:
            case TObjDataType.Union:
                pos += elemCount * 13;
                pos += refCount * 5;
                break;
            default:
                break;
        }
        idx++;
    }
    return sizes;
}

/**
 * Derive a TPC (TBIN) from a PDB by keeping only sections 0-8,
 * rebuilding minimal symbols, and adding the BIN terminator.
 */
export function pdbToTpc(pdb: Buffer): Buffer {
    if (pdb.length < HEADER_SIZE) return Buffer.alloc(0);

    const pdbSectionCount = TObjSection.CountObj; // 20
    const binSectionCount = TObjSection.CountBin; // 9

    // Parse PDB section descriptors
    const pdbSections: { offset: number; size: number; data: Buffer }[] = [];
    for (let i = 0; i < pdbSectionCount; i++) {
        const descOff = HEADER_SIZE + i * SECTION_DESCRIPTOR_SIZE;
        if (descOff + 8 > pdb.length) {
            pdbSections.push({ offset: 0, size: 0, data: Buffer.alloc(0) });
            continue;
        }
        const offset = pdb.readUInt32LE(descOff);
        const size = pdb.readUInt32LE(descOff + 4);
        const data = (offset + size <= pdb.length) ? pdb.slice(offset, offset + size) : Buffer.alloc(0);
        pdbSections.push({ offset, size, data });
    }

    // Rebuild minimal BIN symbols
    const pdbSymData = pdbSections[TObjSection.Symbols].data;
    const binSym = new BinSymbolStringTable();

    const readPdbSym = (off: number): string => {
        if (off === MAXDWORD || off >= pdbSymData.length) return '';
        let s = '';
        for (let i = off; i < pdbSymData.length && pdbSymData[i] !== 0; i++) {
            s += String.fromCharCode(pdbSymData[i]);
        }
        return s;
    };

    // Re-add header metadata strings
    const projectNameOff = pdb.readUInt32LE(32);
    const buildIdOff = pdb.readUInt32LE(36);
    const firmwareVerOff = pdb.readUInt32LE(40);

    const binProjectNameOff = projectNameOff !== MAXDWORD ? binSym.add(readPdbSym(projectNameOff)) : MAXDWORD;
    const binBuildIdOff = buildIdOff !== MAXDWORD ? binSym.add(readPdbSym(buildIdOff)) : MAXDWORD;
    const binFirmwareVerOff = firmwareVerOff !== MAXDWORD ? binSym.add(readPdbSym(firmwareVerOff)) : MAXDWORD;

    // Re-add Extra section strings (timeStr, srcFilePath, configStr)
    const extraData = pdbSections[TObjSection.Extra].data;
    let binTimeStrOff = MAXDWORD;
    let binConfigOff = MAXDWORD;
    if (extraData.length >= 12) {
        const timeOff = extraData.readUInt32LE(0);
        binTimeStrOff = timeOff !== MAXDWORD ? binSym.add(readPdbSym(timeOff)) : MAXDWORD;
        const configOff = extraData.readUInt32LE(8);
        binConfigOff = configOff !== MAXDWORD ? binSym.add(readPdbSym(configOff)) : MAXDWORD;
    }

    // Re-add ResFileDir name strings
    const resFileDirData = pdbSections[TObjSection.ResFileDir].data;
    const resFileDirW = new BinaryWriter();
    let rpos = 0;
    while (rpos + 12 <= resFileDirData.length) {
        const nameOff = resFileDirData.readUInt32LE(rpos); rpos += 4;
        const dataOff = resFileDirData.readUInt32LE(rpos); rpos += 4;
        const sz = resFileDirData.readUInt32LE(rpos); rpos += 4;
        resFileDirW.writeDword(binSym.add(readPdbSym(nameOff)));
        resFileDirW.writeDword(dataOff);
        resFileDirW.writeDword(sz);
    }
    const binResFileDirBuffer = resFileDirW.toBuffer();

    // Build Extra section with new symbol offsets
    const binExtraW = new BinaryWriter();
    binExtraW.writeDword(binTimeStrOff);
    binExtraW.writeDword(MAXDWORD);
    binExtraW.writeDword(binConfigOff);
    const binExtraBuffer = binExtraW.toBuffer();

    const binSymbolsBuffer = binSym.toBuffer();
    const codeBuffer = pdbSections[TObjSection.Code].data;
    const rdataBuffer = pdbSections[TObjSection.RData].data;
    const fileDataBuffer = pdbSections[TObjSection.FileData].data;
    const eventDirBuffer = pdbSections[TObjSection.EventDir].data;
    const libFileDirBuffer = pdbSections[TObjSection.LibFileDir].data;

    // Layout BIN sections
    const headerAndDescSize = HEADER_SIZE + binSectionCount * SECTION_DESCRIPTOR_SIZE;
    let currentOffset = headerAndDescSize;

    const extraOffset = currentOffset; currentOffset += binExtraBuffer.length;
    const eventDirOffset = currentOffset; currentOffset += eventDirBuffer.length;
    const symbolsOffset = currentOffset; currentOffset += binSymbolsBuffer.length;
    const rdataOffset = currentOffset; currentOffset += rdataBuffer.length;
    const fileDataOffset = currentOffset; currentOffset += fileDataBuffer.length;
    const resFileDirOffset = currentOffset; currentOffset += binResFileDirBuffer.length;
    const codeOffset = currentOffset; currentOffset += codeBuffer.length;

    const ALIGNMENT = 128;
    const rawSize = currentOffset + 8; // + terminator
    const fileSize = Math.ceil(rawSize / ALIGNMENT) * ALIGNMENT;

    const emptyDataOffset = fileDataBuffer.length > 0 ? fileDataOffset : rdataOffset;

    const offsets: number[] = new Array(binSectionCount).fill(0);
    const sizes: number[] = new Array(binSectionCount).fill(0);

    offsets[TObjSection.Code] = codeOffset;             sizes[TObjSection.Code] = codeBuffer.length;
    offsets[TObjSection.Init] = 0;                      sizes[TObjSection.Init] = 0;
    offsets[TObjSection.RData] = rdataOffset;            sizes[TObjSection.RData] = rdataBuffer.length;
    offsets[TObjSection.FileData] = fileDataBuffer.length > 0 ? fileDataOffset : emptyDataOffset;
    sizes[TObjSection.FileData] = fileDataBuffer.length;
    offsets[TObjSection.Symbols] = symbolsOffset;        sizes[TObjSection.Symbols] = binSymbolsBuffer.length;
    offsets[TObjSection.ResFileDir] = binResFileDirBuffer.length > 0 ? resFileDirOffset : emptyDataOffset;
    sizes[TObjSection.ResFileDir] = binResFileDirBuffer.length;
    offsets[TObjSection.EventDir] = eventDirOffset;      sizes[TObjSection.EventDir] = eventDirBuffer.length;
    offsets[TObjSection.LibFileDir] = libFileDirBuffer.length > 0 ? (currentOffset - codeBuffer.length - binResFileDirBuffer.length - fileDataBuffer.length - rdataBuffer.length - binSymbolsBuffer.length - eventDirBuffer.length - binExtraBuffer.length + headerAndDescSize) : emptyDataOffset;
    offsets[TObjSection.LibFileDir] = emptyDataOffset;   sizes[TObjSection.LibFileDir] = 0;
    offsets[TObjSection.Extra] = extraOffset;            sizes[TObjSection.Extra] = binExtraBuffer.length;

    const w = new BinaryWriter();
    w.writeDword(TOBJ_SIGNATURE_BIN);
    w.writeWord(pdb.readUInt16LE(4)); // version
    w.writeWord(0); // checksum placeholder
    w.writeDword(fileSize);

    // ALLOC_INFO (copy from PDB)
    w.writeDword(pdb.readUInt32LE(12)); // platformSize
    w.writeDword(pdb.readUInt32LE(16)); // globalAllocSize
    w.writeDword(pdb.readUInt32LE(20)); // stackSize
    w.writeDword(pdb.readUInt32LE(24)); // localAllocSize

    w.writeDword(pdb.readUInt32LE(28)); // flags
    w.writeDword(binProjectNameOff);
    w.writeDword(binBuildIdOff);
    w.writeDword(binFirmwareVerOff);
    w.writeWord(pdb.readUInt16LE(44)); // time day
    w.writeWord(pdb.readUInt16LE(46)); // time minutes

    for (let i = 0; i < binSectionCount; i++) {
        w.writeDword(offsets[i]);
        w.writeDword(sizes[i]);
    }

    w.writeBytes(binExtraBuffer);
    w.writeBytes(eventDirBuffer);
    w.writeBytes(binSymbolsBuffer);
    w.writeBytes(rdataBuffer);
    w.writeBytes(fileDataBuffer);
    w.writeBytes(binResFileDirBuffer);
    w.writeBytes(codeBuffer);

    const paddingNeeded = fileSize - 8 - w.length;
    for (let i = 0; i < paddingNeeded; i++) {
        w.writeByte(0);
    }

    w.writeDword(fileSize);
    w.writeDword(TOBJ_SIGNATURE_BIN);

    const result = w.toBuffer();
    let checksum = 0;
    for (let i = 0; i + 1 < result.length; i += 2) {
        checksum = (checksum + result.readUInt16LE(i)) & 0xFFFF;
    }
    if (result.length % 2 !== 0) {
        checksum = (checksum + result[result.length - 1]) & 0xFFFF;
    }
    checksum = (~checksum + 1) & 0xFFFF;
    result[6] = checksum & 0xFF;
    result[7] = (checksum >> 8) & 0xFF;

    return result;
}

export interface PdbLayoutInfo {
    functionOrder: string[];
    variableAddresses: Map<string, number>;
}

/**
 * Parse a PDB buffer and extract the function ordering (by code address)
 * and variable data-address assignments from its Addresses section.
 * Tags are returned as-is (case preserved).
 */
export function extractPdbLayout(pdb: Buffer): PdbLayoutInfo {
    if (pdb.length < HEADER_SIZE) {
        return { functionOrder: [], variableAddresses: new Map() };
    }

    const pdbSectionCount = TObjSection.CountObj;

    const readSectionBuf = (idx: number): Buffer => {
        const descOff = HEADER_SIZE + idx * SECTION_DESCRIPTOR_SIZE;
        if (descOff + 8 > pdb.length) return Buffer.alloc(0);
        const offset = pdb.readUInt32LE(descOff);
        const size = pdb.readUInt32LE(descOff + 4);
        return (offset + size <= pdb.length) ? pdb.slice(offset, offset + size) : Buffer.alloc(0);
    };

    const symData = readSectionBuf(TObjSection.Symbols);
    const addrData = readSectionBuf(TObjSection.Addresses);

    const readSym = (off: number): string => {
        if (off >= symData.length) return '';
        let s = '';
        for (let i = off; i < symData.length && symData[i] !== 0; i++) {
            s += String.fromCharCode(symData[i]);
        }
        return s;
    };

    const codeFunctions: { tag: string; address: number }[] = [];
    const variableAddresses = new Map<string, number>();

    let pos = 0;
    while (pos + 17 <= addrData.length) {
        const flags = addrData.readUInt8(pos); pos += 1;
        const tagOff = addrData.readUInt32LE(pos); pos += 4;
        const address = addrData.readUInt32LE(pos); pos += 4;
        pos += 4; // baseAddress
        const refCount = addrData.readUInt32LE(pos); pos += 4;
        pos += refCount * 5;

        const tag = readSym(tagOff);
        const tagLc = tag.toLowerCase();

        if (flags & TObjAddressFlags.Code) {
            if ((tagLc.startsWith('?f:') || tagLc.startsWith('!f:')) && (flags & TObjAddressFlags.Defined)) {
                codeFunctions.push({ tag: tagLc, address });
            }
        } else {
            if (tag && (flags & TObjAddressFlags.Defined)) {
                variableAddresses.set(tag, address);
            }
        }
    }

    codeFunctions.sort((a, b) => a.address - b.address);
    const functionOrder = codeFunctions.map(f => f.tag);

    return { functionOrder, variableAddresses };
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
