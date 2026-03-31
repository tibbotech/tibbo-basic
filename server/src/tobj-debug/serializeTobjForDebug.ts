import TOBJ from '../TOBJ';
import {
    TOBJ_DATA_TYPES_NAMES,
    TOBJ_SECTION_DESCRIPTOR,
    TOBJDataType,
    TOBJTypeEntry,
    TOBJAddressEntry,
    TOBJScopeEntry,
    TOBJSourceAnchor,
} from '../types';

function sectionName(index: number): string {
    const n = TOBJ_SECTION_DESCRIPTOR[index];
    return n !== undefined ? String(n) : String(index);
}

function serializeDataType(dt: TOBJDataType, types: TOBJTypeEntry[]): Record<string, unknown> {
    const t = dt.typeDescription;
    let typeRef: { index: number; name: string } | null = null;
    if (t) {
        const idx = types.indexOf(t);
        if (idx >= 0) {
            typeRef = { index: idx, name: t.name };
        }
    }
    return {
        dataType: dt.dataType,
        dataTypeName: TOBJ_DATA_TYPES_NAMES[dt.dataType] ?? `?${dt.dataType}`,
        typeDescriptionInline: dt.typeDescriptionInline,
        typeDescriptionIndex: dt.typeDescriptionIndex,
        typeRef,
    };
}

function serializeAddress(tobj: TOBJ, a: TOBJAddressEntry): Record<string, unknown> {
    return {
        flags: a.flags,
        tag: a.tag,
        tagName: tobj.getSYM(a.tag),
        address: a.address,
        baseAddress: a.baseAddress,
        refCount: a.refCount,
        references: a.references,
    };
}

function serializeAnchor(tobj: TOBJ, anchor: TOBJSourceAnchor): Record<string, unknown> {
    return {
        sourcePosition: {
            fileName: anchor.sourcePosition.fileName,
            line: anchor.sourcePosition.line,
            column: anchor.sourcePosition.column,
        },
        address: anchor.address,
    };
}

function serializeScope(tobj: TOBJ, s: TOBJScopeEntry): Record<string, unknown> {
    return {
        begin: serializeAnchor(tobj, s.begin),
        end: serializeAnchor(tobj, s.end),
    };
}

function serializeType(t: TOBJTypeEntry, types: TOBJTypeEntry[]): Record<string, unknown> {
    return {
        dataType: t.dataType,
        dataTypeName: TOBJ_DATA_TYPES_NAMES[t.dataType] ?? `?${t.dataType}`,
        name: t.name,
        size: t.size,
        elementCount: t.elementCount,
        referenceCount: t.referenceCount,
        referenceDataType: t.referenceDataType ? serializeDataType(t.referenceDataType, types) : undefined,
        enumEntries: t.enumEntries,
        structEntries: t.structEntries.map((m) => ({
            name: m.name,
            offset: m.offset,
            dataType: serializeDataType(m.dataType, types),
        })),
    };
}

/**
 * Plain JSON view of a parsed TOBJ (from {@link TOBJ}) for debugging — no circular refs, buffers summarized.
 */
export function serializeTobjForDebug(tobj: TOBJ): Record<string, unknown> {
    const types = tobj.types;
    const addrIndex = (a: TOBJAddressEntry) => tobj.addresses.indexOf(a);
    const scopeIndex = (s: TOBJScopeEntry) => tobj.scopes.indexOf(s);

    return {
        signature: tobj.signature,
        version: tobj.version,
        checksum: tobj.checksum,
        fileSize: tobj.fileSize,
        projectName: tobj.projectName,
        buildID: tobj.buildID,
        firmwareVersion: tobj.firmwareVersion,
        buildTime: tobj.buildTime.toISOString(),
        platformSize: tobj.platformSize,
        globalAllocationSize: tobj.globalAllocationSize,
        stackSize: tobj.stackSize,
        localAllocSize: tobj.localAllocSize,
        storageAddressStart: tobj.storageAddressStart,
        stackAddressStart: tobj.stackAddressStart,
        flags: tobj.flags,
        descriptors: tobj.descriptors.map((d, i) => ({
            index: i,
            section: sectionName(typeof d.name === 'number' ? d.name : i),
            offset: d.offset,
            size: d.size,
            bufferLength: d.buffer ? d.buffer.length : 0,
            previewHex: d.buffer
                ? d.buffer.subarray(0, Math.min(64, d.buffer.length)).toString('hex')
                : undefined,
        })),
        symbolStringsByteLength: tobj.symbolStrings.length,
        types: types.map((t) => serializeType(t, types)),
        addresses: tobj.addresses.map((a) => serializeAddress(tobj, a)),
        scopes: tobj.scopes.map((s) => serializeScope(tobj, s)),
        variables: tobj.variables.map((v) => ({
            flags: v.flags,
            name: v.name,
            addressIndex: v.address != null ? addrIndex(v.address) : -1,
            address:
                v.address != null ? serializeAddress(tobj, v.address) : { error: 'missing address entry' },
            ownerScopeIndex: v.ownerScope != null ? scopeIndex(v.ownerScope) : -1,
            ownerScope:
                v.ownerScope != null
                    ? serializeScope(tobj, v.ownerScope)
                    : { error: 'missing scope entry' },
            dataType: serializeDataType(v.dataType, types),
        })),
        functions: tobj.functions.map((f) => ({
            flags: f.flags,
            name: f.name,
            addressIndex: f.address != null ? addrIndex(f.address) : -1,
            address:
                f.address != null ? serializeAddress(tobj, f.address) : { error: 'missing address entry' },
            eventIndex: f.eventIndex,
            calleeIndices: f.calleeIndices,
            calleeNames: f.calleeIndices.map((i) => tobj.functions[i]?.name ?? `?${i}`),
        })),
        sourceFiles: tobj.sourceFiles,
        objects: tobj.objects.map((o) => ({
            name: o.name,
            properties: o.properties.map((p) => ({
                name: p.name,
                syscallGet: p.syscallGet,
                syscallSet: p.syscallSet,
                dataType: serializeDataType(p.dataType, types),
            })),
        })),
    };
}
