import { ReferenceType } from './opcodes';

export interface CodeReference {
    type: ReferenceType;
    offset: number;
    targetLabel: string;
}

export interface CodeLabel {
    name: string;
    address: number;
    defined: boolean;
    references: CodeReference[];
    isPublic: boolean;
    isCode: boolean;
}

export interface DataLabel {
    name: string;
    address: number;
    defined: boolean;
    references: CodeReference[];
    isPublic: boolean;
}

export class ByteEmitter {
    private code: number[] = [];
    private initCode: number[] = [];
    private rdata: number[] = [];
    private labels = new Map<string, CodeLabel>();
    private dataLabels = new Map<string, DataLabel>();
    private rdataEntries: RDataEntry[] = [];
    private rdataStringMap = new Map<string, number>();
    private lineInfo: LineInfoEntry[] = [];
    private emittingInit = false;
    private use24BitCode = false;
    private useData32 = false;
    private autoTrackDataRefs = false;
    private addrToDataLabel = new Map<number, DataLabel>();
    private suppressAutoTrack = false;

    get codeSize(): number { return this.code.length; }
    get initSize(): number { return this.initCode.length; }
    get currentOffset(): number { return this.emittingInit ? this.initCode.length : this.code.length; }

    setUse24BitCode(v: boolean): void { this.use24BitCode = v; }
    setUseData32(v: boolean): void { this.useData32 = v; }
    setAutoTrackDataRefs(v: boolean): void { this.autoTrackDataRefs = v; }
    get isData32(): boolean { return this.useData32; }
    get isCode24(): boolean { return this.use24BitCode; }
    get addressSize(): number { return this.use24BitCode ? 3 : 2; }

    beginInit(): void { this.emittingInit = true; }
    endInit(): void { this.emittingInit = false; }

    emitByte(value: number): void {
        const buf = this.emittingInit ? this.initCode : this.code;
        buf.push(value & 0xFF);
    }

    emitWord(value: number): void {
        this.emitByte(value & 0xFF);
        this.emitByte((value >> 8) & 0xFF);
    }

    emitDword(value: number): void {
        this.emitWord(value & 0xFFFF);
        this.emitWord((value >> 16) & 0xFFFF);
    }

    emitAddress(value: number): void {
        if (this.use24BitCode) {
            this.emitByte(value & 0xFF);
            this.emitByte((value >> 8) & 0xFF);
            this.emitByte((value >> 16) & 0xFF);
        } else {
            this.emitWord(value);
        }
    }

    emitDataAddress(value: number): void {
        if (this.autoTrackDataRefs && !this.suppressAutoTrack) {
            const label = this.addrToDataLabel.get(value);
            if (label) {
                const ref: CodeReference = {
                    type: this.emittingInit ? ReferenceType.Init : ReferenceType.Code,
                    offset: this.currentOffset,
                    targetLabel: label.name,
                };
                label.references.push(ref);
            }
        }
        if (this.useData32) {
            this.emitDword(value);
        } else {
            this.emitWord(value);
        }
    }

    defineDataLabel(name: string, address: number, isPublic = false): DataLabel {
        let label = this.dataLabels.get(name);
        if (!label) {
            label = { name, address, defined: true, references: [], isPublic };
            this.dataLabels.set(name, label);
        } else {
            label.address = address;
            label.defined = true;
        }
        if (!this.addrToDataLabel.has(address)) {
            this.addrToDataLabel.set(address, label);
        }
        return label;
    }

    emitDataAddressRef(name: string): void {
        let label = this.dataLabels.get(name);
        if (!label) {
            label = { name, address: 0, defined: false, references: [], isPublic: false };
            this.dataLabels.set(name, label);
        }
        const ref: CodeReference = {
            type: this.emittingInit ? ReferenceType.Init : ReferenceType.Code,
            offset: this.currentOffset,
            targetLabel: name,
        };
        label.references.push(ref);
        this.suppressAutoTrack = true;
        this.emitDataAddress(label.address);
        this.suppressAutoTrack = false;
    }

    getDataLabels(): Map<string, DataLabel> { return this.dataLabels; }

    emitFloat(value: number): void {
        const buf = new ArrayBuffer(4);
        new Float32Array(buf)[0] = value;
        const bytes = new Uint8Array(buf);
        for (const b of bytes) this.emitByte(b);
    }

    // Create or get a label
    createLabel(name: string, isPublic = false, isCode = true): CodeLabel {
        let label = this.labels.get(name);
        if (!label) {
            label = { name, address: 0, defined: false, references: [], isPublic, isCode };
            this.labels.set(name, label);
        }
        return label;
    }

    defineLabel(name: string): CodeLabel {
        const label = this.createLabel(name);
        label.address = this.currentOffset;
        label.defined = true;
        return label;
    }

    emitLabelReference(name: string): void {
        const label = this.createLabel(name);
        const ref: CodeReference = {
            type: this.emittingInit ? ReferenceType.Init : ReferenceType.Code,
            offset: this.currentOffset,
            targetLabel: name,
        };
        label.references.push(ref);
        // Emit placeholder
        this.emitAddress(0);
    }

    // RDATA management
    addRData(data: Buffer | number[]): number {
        const offset = this.rdata.length;
        for (const b of data) this.rdata.push(b & 0xFF);
        return offset;
    }

    addStringRData(str: string): number {
        const existing = this.rdataStringMap.get(str);
        if (existing !== undefined) return existing;
        const offset = this.rdata.length;
        const len = str.length;
        this.rdata.push(len & 0xFF);
        this.rdata.push(len & 0xFF);
        for (let i = 0; i < len; i++) {
            this.rdata.push(str.charCodeAt(i) & 0xFF);
        }
        const entry: RDataEntry = { offset, size: len + 2, references: [] };
        this.rdataEntries.push(entry);
        this.rdataStringMap.set(str, offset);
        return offset;
    }

    recordRDataRef(rdataOffset: number): void {
        const ref: CodeReference = {
            type: this.emittingInit ? ReferenceType.Init : ReferenceType.Code,
            offset: this.currentOffset,
            targetLabel: '',
        };
        const entry = this.rdataEntries.find(e => e.offset === rdataOffset);
        if (entry) {
            entry.references.push(ref);
        }
    }

    // Line info
    addLineInfo(address: number, line: number): void {
        this.lineInfo.push({ address, line });
    }

    // Resolve all label references
    resolveLabels(): void {
        for (const label of this.labels.values()) {
            if (!label.defined) continue;
            for (const ref of label.references) {
                const buf = ref.type === ReferenceType.Init ? this.initCode : this.code;
                const addr = label.address;
                if (this.use24BitCode) {
                    buf[ref.offset] = addr & 0xFF;
                    buf[ref.offset + 1] = (addr >> 8) & 0xFF;
                    buf[ref.offset + 2] = (addr >> 16) & 0xFF;
                } else {
                    buf[ref.offset] = addr & 0xFF;
                    buf[ref.offset + 1] = (addr >> 8) & 0xFF;
                }
            }
        }
    }

    getCode(): Buffer { return Buffer.from(this.code); }
    getInitCode(): Buffer { return Buffer.from(this.initCode); }
    getRData(): Buffer { return Buffer.from(this.rdata); }
    getLabels(): Map<string, CodeLabel> { return this.labels; }
    getRDataEntries(): RDataEntry[] { return this.rdataEntries; }
    getLineInfo(): LineInfoEntry[] { return this.lineInfo; }

    getUnresolvedLabels(): string[] {
        const unresolved: string[] = [];
        for (const label of this.labels.values()) {
            if (!label.defined && label.references.length > 0) {
                unresolved.push(label.name);
            }
        }
        return unresolved;
    }
}

export interface RDataEntry {
    offset: number;
    size: number;
    references: CodeReference[];
}

export interface LineInfoEntry {
    address: number;
    line: number;
}
