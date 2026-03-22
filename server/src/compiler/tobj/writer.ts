import {
    TOBJ_SIGNATURE_OBJ, TOBJ_VERSION, TObjSection, TObjHeaderFlags,
    HEADER_SIZE, SECTION_DESCRIPTOR_SIZE, MAXDWORD,
    TObjAddressFlags, TObjFunctionFlags, TObjRefType, TObjDataType, TObjVariableFlags,
} from './format';
import { ByteEmitter, CodeLabel, RDataEntry, LineInfoEntry } from '../codegen/emitter';
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

export interface TObjWriteOptions {
    includedFiles?: string[];
    platformSize?: number;
    fileSequence?: string[];
    sourceFilePath?: string;
    firmwareVer?: string;
    headerLineCount?: number;
}

export class TObjWriter {
    private symStrings = new SymbolStringTable();
    private sectionData: Buffer[] = [];
    private flags = 0;
    private functionAddrIndex = new Map<string, number>();
    private varAddrIndex = new Map<string, number>();
    private typeIndexMap = new Map<string, number>();

    setFlags(flags: number): void { this.flags = flags; }

    write(emitter: ByteEmitter, symbols: SymbolTable, fileName: string, maxEventNumber = -1, options: TObjWriteOptions = {}): Buffer {
        const includedFiles = options.includedFiles || [];
        const platformSize = options.platformSize ?? 0;

        // Add include file paths to string table FIRST (matching reference ordering)
        const includeFileOffsets: number[] = [];
        for (const incFile of includedFiles) {
            includeFileOffsets.push(this.symStrings.add(incFile));
        }

        // Build section data
        const codeData = emitter.getCode();
        const initData = emitter.getInitCode();
        const rdata = emitter.getRData();

        // Build section buffers
        const sections: Buffer[] = new Array(TObjSection.CountObj).fill(Buffer.alloc(0));

        sections[TObjSection.Code] = codeData;
        sections[TObjSection.Init] = initData;
        sections[TObjSection.RData] = rdata;
        sections[TObjSection.FileData] = Buffer.alloc(0);
        sections[TObjSection.ResFileDir] = Buffer.alloc(0);
        sections[TObjSection.EventDir] = Buffer.alloc(0);
        sections[TObjSection.LibFileDir] = Buffer.alloc(0);
        sections[TObjSection.RDataDir] = this.buildRDataDir(emitter);
        sections[TObjSection.Addresses] = this.buildAddresses(emitter, symbols);
        sections[TObjSection.Types] = this.buildTypes(symbols);
        sections[TObjSection.Functions] = this.buildFunctions(symbols);
        sections[TObjSection.Scopes] = this.buildScopes(symbols, fileName, options.sourceFilePath, options.headerLineCount);
        sections[TObjSection.Variables] = this.buildVariables(symbols);
        sections[TObjSection.Objects] = this.buildObjects(symbols);
        sections[TObjSection.Syscalls] = this.buildSyscalls(symbols);
        sections[TObjSection.LineInfo] = this.buildLineInfo(emitter, fileName, options.fileSequence || [], options.sourceFilePath, options.headerLineCount);
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
        w.writeDword(0);  // globalAllocSize (computed by linker)
        w.writeDword(0);  // stackSize (computed by linker)
        w.writeDword(0);  // localAllocSize (computed by linker)

        w.writeDword(this.flags);
        w.writeDword(MAXDWORD);  // projectName (not used at OBJ level)
        w.writeDword(MAXDWORD);  // buildId (not used at OBJ level)
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
                w.writeDword(handler.address ?? 0);
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

        // Collect function names to identify which labels are function entries
        const functionNames = new Set<string>();
        for (const fn of symbols.getFunctions()) {
            if (!fn.isDeclare) functionNames.add(fn.name);
        }

        // Code labels: only emit function entry labels (with ?F: prefix)
        let addrIndex = 0;
        const labels = emitter.getLabels();
        for (const [name, label] of labels) {
            if (!functionNames.has(name)) continue;

            this.functionAddrIndex.set(name, addrIndex++);

            let flags = TObjAddressFlags.Defined | TObjAddressFlags.Code;
            if (label.isPublic) flags |= TObjAddressFlags.Public;

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(`?F:${name}`));
            w.writeDword(label.address);
            w.writeDword(MAXDWORD);
            w.writeDword(label.references.length);

            for (const ref of label.references) {
                w.writeByte(ref.type);
                w.writeDword(ref.offset);
            }
        }

        // Data labels (global variables)
        const dataLabels = emitter.getDataLabels();
        for (const [name, label] of dataLabels) {
            const varName = name.startsWith('?V:') ? name.substring(3) : name;
            this.varAddrIndex.set(varName, addrIndex++);

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

        return w.toBuffer();
    }

    private buildFunctions(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const fns = symbols.getFunctions();

        for (const fn of fns) {
            if (fn.isDeclare) continue;

            let flags = 0;
            if (fn.isEvent) flags |= TObjFunctionFlags.Event;

            const addrIdx = this.functionAddrIndex.get(fn.name) ?? 0;

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(fn.name));
            w.writeDword(addrIdx);
            w.writeDword(fn.eventNumber ?? 0);
            w.writeDword(fn.callees.size);
        }

        return w.toBuffer();
    }

    private buildScopes(symbols: SymbolTable, fileName: string, sourceFilePath?: string, headerLineCount = 0): Buffer {
        const w = new BinaryWriter();
        const fileNameOff = this.symStrings.add(sourceFilePath || fileName);

        const fns = symbols.getFunctions().filter(fn => !fn.isDeclare);
        for (const fn of fns) {
            const beginLine = fn.location ? Math.max(1, fn.location.line - headerLineCount) : 0;
            const endLine = fn.endLoc ? Math.max(1, fn.endLoc.line - headerLineCount) : beginLine;

            w.writeDword(fileNameOff);
            w.writeDword(beginLine);
            w.writeDword(1);
            w.writeDword(fn.codeStartAddress ?? 0);

            w.writeDword(fileNameOff);
            w.writeDword(endLine);
            w.writeDword(1);
            w.writeDword(fn.codeEndAddress ?? 0);
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

                const addrIdx = v.isGlobal
                    ? (this.varAddrIndex.get(v.name) ?? 0)
                    : (v.address ?? 0);
                const nameStr = v.name;

                w.writeByte(flags);
                w.writeDword(this.symStrings.add(nameStr));
                w.writeDword(addrIdx);
                w.writeDword(scopeIdx);
                this.writeDataType(w, v.dataType);
            }
        };

        writeVars(symbols.globalScope.getVariables(), MAXDWORD);
        let scopeIdx = 1;
        for (const fn of symbols.getFunctions()) {
            if (fn.isDeclare) continue;
            writeVars(fn.parameters, scopeIdx);
            writeVars(fn.localVariables, scopeIdx);
            scopeIdx++;
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

    private buildLineInfo(emitter: ByteEmitter, fileName: string, fileSequence: string[], sourceFilePath?: string, headerLineCount = 0): Buffer {
        const w = new BinaryWriter();
        const entries = emitter.getLineInfo();

        // Emit one block per file in the preprocessing sequence (all with count=0)
        for (const filePath of fileSequence) {
            w.writeDword(this.symStrings.add(filePath));
            w.writeDword(0);
        }

        // Last block: the source file with actual line info
        w.writeDword(this.symStrings.add(sourceFilePath || fileName));
        w.writeDword(entries.length);
        for (const entry of entries) {
            w.writeDword(Math.max(1, entry.line - headerLineCount));
            w.writeDword(entry.address);
        }

        return w.toBuffer();
    }

    private buildIncNameDir(includeFileOffsets: number[]): Buffer {
        const w = new BinaryWriter();
        for (const off of includeFileOffsets) {
            w.writeDword(off);
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
