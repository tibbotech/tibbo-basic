import {
    TOBJ_SIGNATURE_OBJ, TOBJ_VERSION, TObjSection, TObjHeaderFlags,
    HEADER_SIZE, SECTION_DESCRIPTOR_SIZE, MAXDWORD,
    TObjAddressFlags, TObjFunctionFlags, TObjRefType, TObjDataType, TObjVariableFlags,
} from './format';
import { ByteEmitter, CodeLabel, RDataEntry, LineInfoEntry } from '../codegen/emitter';
import { SymbolTable, FunctionSymbol, VariableSymbol, SymbolKind, ObjectSymbol, SyscallSymbol, Scope, ScopeType } from '../semantics/symbols';
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

export class TObjWriter {
    private symStrings = new SymbolStringTable();
    private sectionData: Buffer[] = [];
    private flags = 0;

    setFlags(flags: number): void { this.flags = flags; }

    write(emitter: ByteEmitter, symbols: SymbolTable, fileName: string, maxEventNumber = -1): Buffer {
        // Add file-level symbols
        const projectNameOff = this.symStrings.add(fileName);
        const buildIdOff = this.symStrings.add('');
        const firmwareVerOff = this.symStrings.add('');

        // Build section data
        const codeData = emitter.getCode();
        const initData = emitter.getInitCode();
        const rdata = emitter.getRData();
        const globalSize = this.calcGlobalSize(symbols);

        // Build section buffers
        const sections: Buffer[] = new Array(TObjSection.CountObj).fill(Buffer.alloc(0));

        sections[TObjSection.Code] = codeData;
        sections[TObjSection.Init] = initData;
        sections[TObjSection.RData] = rdata;
        sections[TObjSection.FileData] = Buffer.alloc(0);
        sections[TObjSection.ResFileDir] = Buffer.alloc(0);
        sections[TObjSection.EventDir] = this.buildEventDir(symbols, maxEventNumber, globalSize);
        sections[TObjSection.LibFileDir] = Buffer.alloc(0);
        sections[TObjSection.Extra] = this.buildExtra(fileName);
        sections[TObjSection.Addresses] = this.buildAddresses(emitter);
        sections[TObjSection.Functions] = this.buildFunctions(symbols);
        sections[TObjSection.Scopes] = this.buildScopes(symbols, fileName);
        sections[TObjSection.Variables] = this.buildVariables(symbols);
        sections[TObjSection.Objects] = this.buildObjects(symbols);
        sections[TObjSection.Syscalls] = this.buildSyscalls(symbols);
        sections[TObjSection.Types] = this.buildTypes(symbols);
        sections[TObjSection.RDataDir] = this.buildRDataDir(emitter);
        sections[TObjSection.LineInfo] = this.buildLineInfo(emitter, fileName);
        sections[TObjSection.LibNameDir] = Buffer.alloc(0);
        sections[TObjSection.IncNameDir] = Buffer.alloc(0);

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
        w.writeDword(0);  // platformSize
        w.writeDword(globalSize);
        w.writeDword(0);  // stackSize (computed by linker)
        w.writeDword(0);  // localAllocSize (computed by linker)

        w.writeDword(this.flags);
        w.writeDword(projectNameOff);
        w.writeDword(buildIdOff);
        w.writeDword(firmwareVerOff);

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

        // Compute checksum
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

    private buildExtra(fileName: string): Buffer {
        const w = new BinaryWriter();
        const timeStr = this.symStrings.add(new Date().toISOString());
        const srcPath = this.symStrings.add(fileName);
        w.writeDword(timeStr);
        w.writeDword(srcPath);
        w.writeDword(0);
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

    private buildAddresses(emitter: ByteEmitter): Buffer {
        const w = new BinaryWriter();
        const labels = emitter.getLabels();

        for (const [name, label] of labels) {
            let flags = 0;
            if (label.defined) flags |= TObjAddressFlags.Defined;
            if (label.isPublic) flags |= TObjAddressFlags.Public;
            if (label.isCode) flags |= TObjAddressFlags.Code;

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

            w.writeByte(flags);
            w.writeDword(this.symStrings.add(fn.name));
            w.writeDword(fn.address ?? 0);
            w.writeDword(fn.eventNumber ?? 0);
            w.writeDword(fn.callees.size);

            // Callee indices not resolved at compile time
        }

        return w.toBuffer();
    }

    private buildScopes(symbols: SymbolTable, fileName: string): Buffer {
        const w = new BinaryWriter();
        const scopes = symbols.getScopes();
        const fileNameOff = this.symStrings.add(fileName);

        for (const scope of scopes) {
            // Begin anchor
            w.writeDword(fileNameOff);
            w.writeDword(0); // line
            w.writeDword(0); // col
            w.writeDword(scope.startAddress);
            // End anchor
            w.writeDword(fileNameOff);
            w.writeDword(0);
            w.writeDword(0);
            w.writeDword(scope.endAddress);
        }

        return w.toBuffer();
    }

    private buildVariables(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();

        const writeVars = (vars: VariableSymbol[]): void => {
            for (const v of vars) {
                let flags = 0;
                if (v.kind === SymbolKind.Parameter) flags |= TObjVariableFlags.Argument;
                if (v.isByRef) flags |= TObjVariableFlags.ByRef;

                w.writeByte(flags);
                w.writeDword(this.symStrings.add(v.name));
                w.writeDword(v.address ?? 0);
                w.writeDword(0); // owner scope index
                this.writeDataType(w, v.dataType);
            }
        };

        writeVars(symbols.globalScope.getVariables());
        for (const fn of symbols.getFunctions()) {
            if (fn.isDeclare) continue;
            writeVars(fn.parameters);
            writeVars(fn.localVariables);
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
        const allSyms = symbols.globalScope.getAllSymbols();

        for (const sym of allSyms) {
            if (sym.kind !== SymbolKind.Syscall) continue;
            const sc = sym as SyscallSymbol;
            w.writeDword(this.symStrings.add(sc.name));
            w.writeWord(sc.syscallNumber);
        }

        return w.toBuffer();
    }

    private buildTypes(symbols: SymbolTable): Buffer {
        const w = new BinaryWriter();
        const allSyms = symbols.globalScope.getAllSymbols();

        for (const sym of allSyms) {
            if (sym.kind === SymbolKind.Type && sym.dataType) {
                this.writeTypeEntry(w, sym.dataType);
            }
            if (sym.kind === SymbolKind.Enum && sym.dataType) {
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

    private buildLineInfo(emitter: ByteEmitter, fileName: string): Buffer {
        const w = new BinaryWriter();
        const entries = emitter.getLineInfo();

        if (entries.length === 0) return w.toBuffer();

        w.writeDword(this.symStrings.add(fileName));
        w.writeDword(entries.length);

        for (const entry of entries) {
            w.writeDword(entry.line);
            w.writeDword(entry.address);
        }

        return w.toBuffer();
    }

    private writeDataType(w: BinaryWriter, dt?: DataType): void {
        if (!dt) {
            w.writeByte(TObjDataType.Byte);
            w.writeByte(0);
            w.writeWord(0);
            return;
        }

        if (isPrimitive(dt)) {
            w.writeByte(this.primitiveToTObjType(dt.name));
            w.writeByte(0);
            w.writeWord(0);
        } else if (isString(dt)) {
            w.writeByte(TObjDataType.String);
            w.writeByte((dt as any).maxLength & 0xFF);
            w.writeWord(0);
        } else if (isArray(dt)) {
            w.writeByte(TObjDataType.Array);
            w.writeByte(0);
            w.writeWord(0); // type desc offset
        } else if (isStruct(dt)) {
            w.writeByte(TObjDataType.Struct);
            w.writeByte(0);
            w.writeWord(0); // type desc offset
        } else if (isEnum(dt)) {
            w.writeByte(TObjDataType.Enum);
            w.writeByte(0);
            w.writeWord(0); // type desc offset
        } else {
            w.writeByte(TObjDataType.Byte);
            w.writeByte(0);
            w.writeWord(0);
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

    private calcGlobalSize(symbols: SymbolTable): number {
        let size = 0;
        for (const v of symbols.globalScope.getVariables()) {
            const s = v.dataType?.size ?? 1;
            size += s;
        }
        return size;
    }
}
