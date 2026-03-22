import {
    TOBJ_SIGNATURE_OBJ, TOBJ_VERSION, TObjSection, TObjHeaderFlags,
    HEADER_SIZE, SECTION_DESCRIPTOR_SIZE, MAXDWORD,
    TObjAddressFlags, TObjFunctionFlags, TObjRefType, TObjDataType, TObjVariableFlags,
} from './format';
import { ByteEmitter, CodeLabel, RDataEntry, LineInfoEntry } from '../codegen/emitter';
import { ReferenceType } from '../codegen/opcodes';
import { SymbolTable, FunctionSymbol, VariableSymbol, SymbolKind, ObjectSymbol, SyscallSymbol, PropertySymbol, Scope, ScopeType } from '../semantics/symbols';
import { DataType, isPrimitive, isString, isArray, isStruct, isEnum, PrimitiveType, StringDataType, ArrayDataType, StructDataType, EnumDataType } from '../semantics/types';

export class BinaryWriter {
    private buf: number[] = [];

    get length(): number { return this.buf.length; }

    writeByte(v: number): void { this.buf.push(v & 0xFF); }

    writeWord(v: number): void {
        this.writeByte(v & 0xFF);
        this.writeByte((v >> 8) & 0xFF);
    }

    writeDword(v: number): void {
        this.writeWord(v & 0xFFFF);
        this.writeWord((v >> 16) & 0xFFFF);
    }

    writeBytes(data: Buffer | number[]): void {
        for (const b of data) this.writeByte(b);
    }

    writeString(s: string): void {
        for (let i = 0; i < s.length; i++) this.writeByte(s.charCodeAt(i));
        this.writeByte(0);
    }

    toBuffer(): Buffer { return Buffer.from(this.buf); }
}

class SymbolStringTable {
    private strings: string[] = [];
    private offsets = new Map<string, number>();
    private data: number[] = [];

    add(s: string): number {
        const existing = this.offsets.get(s);
        if (existing !== undefined) return existing;
        const offset = this.data.length;
        for (let i = 0; i < s.length; i++) this.data.push(s.charCodeAt(i));
        this.data.push(0);
        this.offsets.set(s, offset);
        this.strings.push(s);
        return offset;
    }

    toBuffer(): Buffer { return Buffer.from(this.data); }
}

export interface SourceMapEntry {
    filePath: string;
    combinedStartLine: number;
    lineCount: number;
}

export interface TObjWriteOptions {
    includedFiles?: string[];
    platformSize?: number;
    fileSequence?: string[];
    sourceFilePath?: string;
    firmwareVer?: string;
    headerLineCount?: number;
    globalAllocSize?: number;
    localAllocSize?: number;
    stackSize?: number;
    fileData?: Buffer;
    resourceEntries?: Array<{ name: string; dataOffset: number; size: number }>;
    sourceMap?: SourceMapEntry[];
    mergeInitIntoCode?: boolean;
    projectName?: string;
    buildId?: string;
}

export class TObjWriter {
    private symStrings = new SymbolStringTable();
    private sectionData: Buffer[] = [];
    private flags = 0;
    private functionAddrIndex = new Map<string, number>();
    private varAddrIndex = new Map<string, number>();
    private localVarAddrIndex = new Map<VariableSymbol, number>();
    private scopeIndexMap = new Map<Scope, number>();
    private typeIndexMap = new Map<string, number>();

    setFlags(flags: number): void { this.flags = flags; }

    write(emitter: ByteEmitter, symbols: SymbolTable, fileName: string, maxEventNumber = -1, options: TObjWriteOptions = {}): Buffer {
        this.functionAddrIndex.clear();
        this.varAddrIndex.clear();
        this.localVarAddrIndex.clear();
        this.scopeIndexMap.clear();
        const includedFiles = options.includedFiles || [];
        const platformSize = options.platformSize ?? 0;

        // Add include file paths to string table FIRST (matching reference ordering)
        const includeFileOffsets: number[] = [];
        for (const incFile of includedFiles) {
            includeFileOffsets.push(this.symStrings.add(incFile));
        }

        // Pre-add project metadata strings (before Symbols section is built)
        const projectNameOff = options.projectName ? this.symStrings.add(options.projectName) : MAXDWORD;
        const buildIdOff = options.buildId ? this.symStrings.add(options.buildId) : MAXDWORD;

        // Build section data
        let codeData = emitter.getCode();
        let initData = emitter.getInitCode();
        const rdata = emitter.getRData();

        if (options.mergeInitIntoCode && initData.length > 0) {
            const initSize = initData.length + 1;
            for (const label of emitter.getLabels().values()) {
                if (label.defined) label.address += initSize;
                for (const ref of label.references) {
                    if (ref.type === ReferenceType.Code) {
                        ref.offset += initSize;
                    }
                }
            }
            for (const label of emitter.getDataLabels().values()) {
                for (const ref of label.references) {
                    if (ref.type === ReferenceType.Code) {
                        ref.offset += initSize;
                    }
                }
            }
            for (const entry of emitter.getLineInfo()) {
                entry.address += initSize;
            }
            for (const entry of emitter.getRDataEntries()) {
                for (const ref of entry.references) {
                    if (ref.type === ReferenceType.Code) {
                        ref.offset += initSize;
                    }
                }
            }
            for (const fn of symbols.getFunctions()) {
                if (fn.codeStartAddress != null) fn.codeStartAddress += initSize;
                if (fn.codeEndAddress != null) fn.codeEndAddress += initSize;
            }
            for (const scope of symbols.getScopes()) {
                if (scope.startAddress != null) scope.startAddress += initSize;
                if (scope.endAddress != null) scope.endAddress += initSize;
            }
            codeData = Buffer.concat([initData, Buffer.from([0x1F]), codeData]);

            for (const label of emitter.getLabels().values()) {
                if (!label.defined || !label.isCode) continue;
                for (const ref of label.references) {
                    const off = ref.offset;
                    if (off + 3 <= codeData.length) {
                        const cur = emitter.isCode24
                            ? codeData[off] | (codeData[off + 1] << 8) | (codeData[off + 2] << 16)
                            : codeData[off] | (codeData[off + 1] << 8);
                        const adj = cur + initSize;
                        codeData[off] = adj & 0xFF;
                        codeData[off + 1] = (adj >> 8) & 0xFF;
                        if (emitter.isCode24) codeData[off + 2] = (adj >> 16) & 0xFF;
                    }
                }
            }
        }

        // Build section buffers
        const sections: Buffer[] = new Array(TObjSection.CountObj).fill(Buffer.alloc(0));

        sections[TObjSection.Code] = codeData;
        sections[TObjSection.Init] = initData;
        sections[TObjSection.RData] = rdata;
        sections[TObjSection.FileData] = options.fileData ?? Buffer.alloc(0);
        sections[TObjSection.ResFileDir] = this.buildResFileDir(options.resourceEntries ?? []);
        sections[TObjSection.EventDir] = this.buildEventDir(symbols, maxEventNumber, platformSize + (options.globalAllocSize ?? 0) + (options.stackSize ?? 0));
        sections[TObjSection.LibFileDir] = Buffer.alloc(0);
        sections[TObjSection.RDataDir] = this.buildRDataDir(emitter);
        sections[TObjSection.Addresses] = this.buildAddresses(emitter, symbols);
        sections[TObjSection.Types] = this.buildTypes(symbols);
        sections[TObjSection.Functions] = this.buildFunctions(symbols);
        sections[TObjSection.Scopes] = this.buildScopes(symbols, fileName, options.sourceFilePath, options.headerLineCount);
        sections[TObjSection.Variables] = this.buildVariables(symbols);
        sections[TObjSection.Objects] = this.buildObjects(symbols);
        sections[TObjSection.Syscalls] = this.buildSyscalls(symbols);
        sections[TObjSection.LineInfo] = this.buildLineInfo(emitter, fileName, options.fileSequence || [], options.sourceFilePath, options.headerLineCount, options.sourceMap);
        sections[TObjSection.LibNameDir] = Buffer.alloc(0);
        sections[TObjSection.IncNameDir] = this.buildIncNameDir(includeFileOffsets);
        sections[TObjSection.Extra] = this.buildExtra(fileName, options.sourceFilePath, options.firmwareVer);

        // Symbols section is built last since other sections add to it
        sections[TObjSection.Symbols] = this.symStrings.toBuffer();

        // Calculate offsets
        const sectionCount = TObjSection.CountObj;
        const headerAndDescSize = HEADER_SIZE + sectionCount * SECTION_DESCRIPTOR_SIZE;
        let currentOffset = headerAndDescSize;
        const offsets: number[] = [];

        for (let i = 0; i < sectionCount; i++) {
            offsets.push(currentOffset);
            currentOffset += sections[i].length;
        }

        const fileSize = currentOffset;

        // Write header
        const w = new BinaryWriter();
        w.writeDword(TOBJ_SIGNATURE_OBJ);
        w.writeWord(TOBJ_VERSION);
        w.writeWord(0);  // checksum placeholder
        w.writeDword(fileSize);

        // TOBJ_ALLOC_INFO
        w.writeDword(platformSize);
        w.writeDword(options.globalAllocSize ?? 0);
        w.writeDword(options.stackSize ?? 0);
        w.writeDword(options.localAllocSize ?? 0);

        w.writeDword(this.flags);
        w.writeDword(projectNameOff);
        w.writeDword(buildIdOff);
        w.writeDword(MAXDWORD);  // firmwareVer (not used at OBJ level)

        // File time
        const now = new Date();
        const daysSince2000 = Math.floor((now.getTime() - new Date(2000, 0, 1).getTime()) / 86400000);
        const minutesOfDay = now.getHours() * 60 + now.getMinutes();
        w.writeWord(daysSince2000 & 0xFFFF);
        w.writeWord(minutesOfDay & 0xFFFF);

        // Section descriptors
        for (let i = 0; i < sectionCount; i++) {
            w.writeDword(offsets[i]);
            w.writeDword(sections[i].length);
        }

        // Section data
        for (let i = 0; i < sectionCount; i++) {
            w.writeBytes(sections[i]);
        }

        // Checksum (16-bit word-level sum, matching reference C++ compiler)
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

    private buildExtra(fileName: string, sourceFilePath?: string, firmwareVer?: string): Buffer {
        const w = new BinaryWriter();
        const now = new Date();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dd = String(now.getDate()).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const timeFormatted = `${dayNames[now.getDay()]}, ${dd}-${monthNames[now.getMonth()]}-${yy} ${hh}:${mm}:${ss} ${yy}${MM}${dd}${hh}${mm}${ss}`;

        const fdOff = this.symStrings.add('<FD>');
        if (firmwareVer) {
            this.symStrings.add(firmwareVer);
        }
        const timeStrOff = this.symStrings.add(timeFormatted);
        const srcPathOff = this.symStrings.add(sourceFilePath || fileName);
        w.writeDword(timeStrOff);
        w.writeDword(srcPathOff);
        w.writeDword(fdOff);
        return w.toBuffer();
    }

    private buildEventDir(symbols: SymbolTable, maxEventNumber: number, globalDataSize: number): Buffer {
        const w = new BinaryWriter();
        if (maxEventNumber < 0) return w.toBuffer();

        const entryCount = maxEventNumber + 1;
        const eventHandlers = new Map<number, FunctionSymbol>();
        for (const fn of symbols.getFunctions()) {
            if (fn.isEvent && fn.eventNumber !== undefined) {
                eventHandlers.set(fn.eventNumber, fn);
            }
        }

        for (let i = 0; i < entryCount; i++) {
            const handler = eventHandlers.get(i);
            if (handler) {
                w.writeDword(handler.codeStartAddress ?? 0);
                w.writeDword(globalDataSize);
            } else {
                w.writeDword(MAXDWORD);
                w.writeDword(MAXDWORD);
            }
        }
        return w.toBuffer();
    }

    private buildAddresses(emitter: ByteEmitter, symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();

        let addrIndex = 0;
        const labels = emitter.getLabels();
        const emittedCodeLabels = new Set<string>();
        for (const fn of symbols.getFunctions()) {
            const label = labels.get(fn.name);
            if (!label) continue;
            if (!label.defined && label.references.length === 0) continue;

            emittedCodeLabels.add(fn.name);
            this.functionAddrIndex.set(fn.name, addrIndex++);

            let flags = TObjAddressFlags.Code;
            if (label.defined) flags |= TObjAddressFlags.Defined;
            if (fn.isPublic || label.isPublic) flags |= TObjAddressFlags.Public;

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(`?F:${fn.name}`));
            w.writeDword(label.address);
            w.writeDword(MAXDWORD);
            w.writeDword(label.references.length);

            for (const ref of label.references) {
                w.writeByte(ref.type);
                w.writeDword(ref.offset);
            }
        }

        for (const [name, label] of labels) {
            if (emittedCodeLabels.has(name)) continue;
            if (!label.defined && label.references.length === 0) continue;
            if (/^sub_end_\d+$/.test(name) || /^fn_end_\d+$/.test(name)) continue;

            let flags = TObjAddressFlags.Code;
            if (label.defined) flags |= TObjAddressFlags.Defined;
            if (label.isPublic) flags |= TObjAddressFlags.Public;

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(name));
            w.writeDword(label.address);
            w.writeDword(MAXDWORD);
            w.writeDword(label.references.length);

            for (const ref of label.references) {
                w.writeByte(ref.type);
                w.writeDword(ref.offset);
            }

            addrIndex++;
        }

        // Data labels (global and local variables)
        const dataLabels = emitter.getDataLabels();
        const dataLabelNames = new Set<string>();
        for (const [name, label] of dataLabels) {
            dataLabelNames.add(name);
            const varName = name.startsWith('?V:') ? name.substring(3) : name;
            const idx = addrIndex++;

            const isLocal = name.includes(':local(');
            const isParam = name.startsWith('?A:');
            if (isParam) {
                const paramMatch = name.match(/^\?A:(.+?):(\d+)$/);
                if (paramMatch) {
                    const fnName = paramMatch[1];
                    const paramIdx = parseInt(paramMatch[2], 10);
                    for (const fn of symbols.getFunctions()) {
                        if (fn.name === fnName && !fn.isDeclare && paramIdx < fn.parameters.length) {
                            const v = fn.parameters[paramIdx];
                            if (!this.localVarAddrIndex.has(v)) {
                                this.localVarAddrIndex.set(v, idx);
                            }
                            break;
                        }
                    }
                }
            } else if (isLocal) {
                const match = name.match(/^\?V:(.+?):local\(/);
                if (match) {
                    const simpleName = match[1];
                    for (const fn of symbols.getFunctions()) {
                        if (fn.isDeclare) continue;
                        for (const v of [...fn.parameters, ...fn.localVariables]) {
                            if (v.name === simpleName && !this.localVarAddrIndex.has(v)) {
                                this.localVarAddrIndex.set(v, idx);
                            }
                        }
                    }
                }
            } else {
                this.varAddrIndex.set(varName, idx);
            }

            let flags = 0;
            if (label.defined) flags |= TObjAddressFlags.Defined;
            if (label.isPublic) flags |= TObjAddressFlags.Public;

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(name));
            w.writeDword(label.address);
            w.writeDword(MAXDWORD);
            w.writeDword(label.references.length);

            for (const ref of label.references) {
                w.writeByte(ref.type);
                w.writeDword(ref.offset);
            }
        }

        let localVarOrdinal = 0;
        for (const fn of symbols.getFunctions()) {
            if (fn.isDeclare) continue;
            for (const v of [...fn.parameters, ...fn.localVariables]) {
                if (v.address == null) continue;
                if (this.localVarAddrIndex.has(v)) {
                    localVarOrdinal++;
                    continue;
                }
                this.localVarAddrIndex.set(v, addrIndex++);

                w.writeByte(TObjAddressFlags.Defined);
                w.writeDword(this.symStrings.add(`!V:${fn.name}:${v.name}:${localVarOrdinal++}`));
                w.writeDword(v.address);
                w.writeDword(MAXDWORD);
                w.writeDword(0);
            }
        }

        return w.toBuffer();
    }

    private buildFunctions(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const fns = symbols.getFunctions().filter(fn => this.functionAddrIndex.has(fn.name));
        const functionIndex = new Map<string, number>();

        for (let i = 0; i < fns.length; i++) {
            functionIndex.set(fns[i].name.toLowerCase(), i);
        }

        for (const fn of fns) {
            let flags = 0;
            if (fn.isEvent) flags |= TObjFunctionFlags.Event;

            const addrIdx = this.functionAddrIndex.get(fn.name) ?? 0;
            const calleeIndexes = [...fn.callees]
                .map(name => functionIndex.get(name.toLowerCase()))
                .filter((idx): idx is number => idx !== undefined);

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(fn.name));
            w.writeDword(addrIdx);
            w.writeDword(fn.isEvent ? (fn.eventNumber ?? 0) : MAXDWORD);
            w.writeDword(calleeIndexes.length);
            for (const idx of calleeIndexes) {
                w.writeDword(idx);
            }
        }

        return w.toBuffer();
    }

    private buildScopes(symbols: SymbolTable, fileName: string, sourceFilePath?: string, headerLineCount = 0): Buffer {
        const w = new BinaryWriter();
        const fileNameOff = this.symStrings.add(sourceFilePath || fileName);
        const seenFunctions = new Set<FunctionSymbol>();
        const scopes = symbols.getScopes().filter(scope => {
            if (scope === symbols.globalScope) return false;
            if (scope.type !== ScopeType.Function && scope.type !== ScopeType.Sub) return false;
            if (scope.ownerFunction) {
                if (seenFunctions.has(scope.ownerFunction)) return false;
                seenFunctions.add(scope.ownerFunction);
            }
            return true;
        });
        for (let i = 0; i < scopes.length; i++) {
            const scope = scopes[i];
            this.scopeIndexMap.set(scope, i);
            const owner = scope.ownerFunction;
            const beginLine = owner?.location ? Math.max(1, owner.location.line - headerLineCount) : 0;
            const endLine = owner?.endLoc ? Math.max(1, owner.endLoc.line - headerLineCount) : beginLine;
            const beginAddress = scope.startAddress || owner?.codeStartAddress || 0;
            const endAddress = scope.endAddress || owner?.codeEndAddress || beginAddress;
            w.writeDword(fileNameOff);
            w.writeDword(beginLine);
            w.writeDword(1);
            w.writeDword(beginAddress);

            w.writeDword(fileNameOff);
            w.writeDword(endLine);
            w.writeDword(1);
            w.writeDword(endAddress);
        }

        return w.toBuffer();
    }

    private buildVariables(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();

        const writeVars = (vars: VariableSymbol[], scopeIdx: number): void => {
            for (const v of vars) {
                let flags = 0;
                if (v.kind === SymbolKind.Parameter) flags |= TObjVariableFlags.Argument;
                if (v.isByRef) flags |= TObjVariableFlags.ByRef;
                if (v.isTemp) flags |= TObjVariableFlags.Temp;

                const addrIdx = v.isGlobal
                    ? (this.varAddrIndex.get(v.name) ?? 0)
                    : (this.localVarAddrIndex.get(v) ?? 0);
                const ownerScopeIdx = v.isGlobal
                    ? MAXDWORD
                    : (v.ownerScope ? (this.scopeIndexMap.get(v.ownerScope) ?? 0) : 0);
                const nameStr = v.name;

                w.writeByte(flags);
                w.writeDword(this.symStrings.add(nameStr));
                w.writeDword(addrIdx);
                w.writeDword(ownerScopeIdx);
                this.writeDataType(w, v.dataType);
            }
        };

        writeVars(symbols.globalScope.getVariables(), MAXDWORD);
        for (const fn of symbols.getFunctions()) {
            if (fn.isDeclare) continue;
            writeVars(fn.parameters, 0);
            writeVars(fn.localVariables, 0);
        }

        return w.toBuffer();
    }

    private buildObjects(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const allSyms = symbols.globalScope.getAllSymbols();

        for (const sym of allSyms) {
            if (sym.kind !== SymbolKind.Object) continue;
            const obj = sym as ObjectSymbol;
            w.writeDword(this.symStrings.add(obj.name));
            w.writeDword(obj.properties.size);

            for (const [, prop] of obj.properties) {
                w.writeDword(this.symStrings.add(prop.name));
                w.writeDword(prop.getterSyscall ?? MAXDWORD);
                w.writeDword(prop.setterSyscall ?? MAXDWORD);
                this.writeDataType(w, prop.dataType);
            }
        }

        return w.toBuffer();
    }

    private buildSyscalls(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const allSyscalls = symbols.getSyscalls();

        for (const sc of allSyscalls) {
            let displayName: string;
            if (sc.name.startsWith('get_') || sc.name.startsWith('set_')) {
                displayName = sc.name;
            } else if (sc.objectName) {
                const prefix = sc.isInternal ? '!' : '';
                displayName = `${prefix}${sc.objectName}.${sc.name}`;
            } else {
                displayName = sc.isInternal ? `!${sc.name}` : sc.name;
            }
            w.writeDword(this.symStrings.add(displayName));
            w.writeWord(sc.syscallNumber);
        }

        return w.toBuffer();
    }

    private buildTypes(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const allSyms = symbols.globalScope.getAllSymbols();

        let typeIdx = 0;
        for (const sym of allSyms) {
            if ((sym.kind === SymbolKind.Type || sym.kind === SymbolKind.Enum) && sym.dataType) {
                if (isString(sym.dataType)) continue;
                this.typeIndexMap.set(sym.dataType.name.toLowerCase(), typeIdx);
                typeIdx++;
                this.writeTypeEntry(w, sym.dataType);
            }
        }

        return w.toBuffer();
    }

    private buildRDataDir(emitter: ByteEmitter): Buffer {
        const w = new BinaryWriter();
        const entries = emitter.getRDataEntries();

        for (const entry of entries) {
            w.writeDword(entry.offset);
            w.writeDword(entry.size);
            w.writeDword(entry.references.length);

            for (const ref of entry.references) {
                w.writeByte(ref.type);
                w.writeDword(ref.offset);
            }
        }

        return w.toBuffer();
    }

    private buildLineInfo(emitter: ByteEmitter, fileName: string, fileSequence: string[], sourceFilePath?: string, headerLineCount = 0, sourceMap?: SourceMapEntry[]): Buffer {
        const w = new BinaryWriter();
        const entries = emitter.getLineInfo();

        if (sourceMap && sourceMap.length > 0) {
            const fileEntries = new Map<string, Array<{ line: number; address: number }>>();

            for (const entry of entries) {
                const mapping = this.lookupSourceMap(entry.line, sourceMap);
                if (!mapping) continue;

                let lines = fileEntries.get(mapping.filePath);
                if (!lines) {
                    lines = [];
                    fileEntries.set(mapping.filePath, lines);
                }
                lines.push({ line: mapping.originalLine, address: entry.address });
            }

            for (const [filePath, rawLines] of fileEntries) {
                const lines = rawLines.filter((l, i) =>
                    i === rawLines.length - 1 || l.address !== rawLines[i + 1].address,
                );
                w.writeDword(this.symStrings.add(filePath));
                w.writeDword(lines.length);
                for (const line of lines) {
                    w.writeDword(Math.max(1, line.line));
                    w.writeDword(line.address);
                }
            }
        } else {
            for (const filePath of fileSequence) {
                w.writeDword(this.symStrings.add(filePath));
                w.writeDword(0);
            }

            w.writeDword(this.symStrings.add(sourceFilePath || fileName));
            w.writeDword(entries.length);
            for (const entry of entries) {
                w.writeDword(Math.max(1, entry.line - headerLineCount));
                w.writeDword(entry.address);
            }
        }

        return w.toBuffer();
    }

    private lookupSourceMap(combinedLine: number, sourceMap: SourceMapEntry[]): { filePath: string; originalLine: number } | null {
        for (const entry of sourceMap) {
            if (combinedLine >= entry.combinedStartLine && combinedLine < entry.combinedStartLine + entry.lineCount) {
                return {
                    filePath: entry.filePath,
                    originalLine: combinedLine - entry.combinedStartLine + 1,
                };
            }
        }
        return null;
    }

    private buildIncNameDir(includeFileOffsets: number[]): Buffer {
        const w = new BinaryWriter();
        for (const off of includeFileOffsets) {
            w.writeDword(off);
        }
        return w.toBuffer();
    }

    private buildResFileDir(entries: Array<{ name: string; dataOffset: number; size: number }>): Buffer {
        const w = new BinaryWriter();
        for (const entry of entries) {
            w.writeDword(this.symStrings.add(entry.name));
            w.writeDword(entry.dataOffset);
            w.writeDword(entry.size);
        }
        return w.toBuffer();
    }

    private writeDataType(w: BinaryWriter, dt?: DataType): void {
        if (!dt) {
            w.writeByte(TObjDataType.Byte);
            w.writeDword(0);
            return;
        }

        if (isPrimitive(dt)) {
            w.writeByte(this.primitiveToTObjType(dt.name));
            w.writeDword(0);
        } else if (isString(dt)) {
            w.writeByte(TObjDataType.String);
            w.writeByte((dt as any).maxLength & 0xFF);
            w.writeByte(0);
            w.writeWord(0);
        } else if (isArray(dt)) {
            w.writeByte(TObjDataType.Array);
            w.writeDword(this.typeIndexMap.get(dt.name.toLowerCase()) ?? 0);
        } else if (isStruct(dt)) {
            w.writeByte(TObjDataType.Struct);
            w.writeDword(this.typeIndexMap.get(dt.name.toLowerCase()) ?? 0);
        } else if (isEnum(dt)) {
            w.writeByte(TObjDataType.Enum);
            w.writeDword(this.typeIndexMap.get(dt.name.toLowerCase()) ?? 0);
        } else {
            w.writeByte(TObjDataType.Byte);
            w.writeDword(0);
        }
    }

    private writeTypeEntry(w: BinaryWriter, dt: DataType): void {
        if (isEnum(dt)) {
            const e = dt as EnumDataType;
            w.writeByte(TObjDataType.Enum);
            w.writeDword(this.symStrings.add(dt.name));
            w.writeDword(dt.size);
            w.writeDword(e.members.length);
            w.writeDword(0); // ref count

            w.writeByte(this.primitiveToTObjType(e.actualType.name));
            for (const m of e.members) {
                w.writeDword(this.symStrings.add(m.name));
                w.writeDword(Number(m.value) & 0xFFFFFFFF);
            }
        } else if (isStruct(dt)) {
            const s = dt as StructDataType;
            w.writeByte(TObjDataType.Struct);
            w.writeDword(this.symStrings.add(dt.name));
            w.writeDword(dt.size);
            w.writeDword(s.members.length);
            w.writeDword(0); // ref count

            for (const m of s.members) {
                w.writeDword(this.symStrings.add(m.name));
                this.writeDataType(w, m.dataType);
                w.writeDword(m.offset);
            }
        } else if (isArray(dt)) {
            const a = dt as ArrayDataType;
            w.writeByte(TObjDataType.Array);
            w.writeDword(this.symStrings.add(dt.name));
            w.writeDword(dt.size);
            w.writeDword(a.elementCount);
            w.writeDword(0); // ref count

            this.writeDataType(w, a.elementType);
        }
    }

    private primitiveToTObjType(name: string): number {
        switch (name.toLowerCase()) {
            case 'boolean': return TObjDataType.Boolean;
            case 'byte': return TObjDataType.Byte;
            case 'char': return TObjDataType.Char;
            case 'word': return TObjDataType.Word;
            case 'short': return TObjDataType.Short;
            case 'dword': return TObjDataType.Dword;
            case 'long': return TObjDataType.Long;
            case 'real': case 'float': return TObjDataType.Real;
            case 'string': return TObjDataType.String;
            case 'integer': return TObjDataType.Short;
            default: return TObjDataType.Byte;
        }
    }

}
