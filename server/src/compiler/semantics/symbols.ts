import { SourceLocation } from '../errors';
import { DataType } from './types';

export enum ScopeType {
    Global = 'global',
    Function = 'function',
    Sub = 'sub',
    If = 'if',
    Else = 'else',
    For = 'for',
    While = 'while',
    Do = 'do',
    Case = 'case',
}

export enum SymbolKind {
    Variable = 'variable',
    Constant = 'constant',
    Function = 'function',
    Sub = 'sub',
    Type = 'type',
    Enum = 'enum',
    EnumMember = 'enum_member',
    Object = 'object',
    Property = 'property',
    Syscall = 'syscall',
    Event = 'event',
    Label = 'label',
    Parameter = 'parameter',
}

export interface Symbol {
    name: string;
    kind: SymbolKind;
    dataType?: DataType;
    location: SourceLocation;
    isPublic: boolean;
    isDeclare: boolean;
}

export interface VariableSymbol extends Symbol {
    kind: SymbolKind.Variable | SymbolKind.Parameter;
    isByRef: boolean;
    isGlobal: boolean;
    isTemp?: boolean;
    ownerScope?: Scope;
    address?: number;
    size?: number;
    initialValue?: any;
}

export interface ConstantSymbol extends Symbol {
    kind: SymbolKind.Constant;
    value: number | string | boolean;
}

export interface FunctionSymbol extends Symbol {
    kind: SymbolKind.Function | SymbolKind.Sub;
    parameters: VariableSymbol[];
    returnType?: DataType;
    address?: number;
    localVariables: VariableSymbol[];
    callees: Set<string>;
    isEvent: boolean;
    eventNumber?: number;
    localAllocSize?: number;
    codeStartAddress?: number;
    codeEndAddress?: number;
    endLoc?: SourceLocation;
}

export interface TypeSymbol extends Symbol {
    kind: SymbolKind.Type;
}

export interface EnumSymbol extends Symbol {
    kind: SymbolKind.Enum;
}

export interface ObjectSymbol extends Symbol {
    kind: SymbolKind.Object;
    properties: Map<string, PropertySymbol>;
    functions: Map<string, SyscallSymbol>;
    events: Map<string, EventSymbol>;
}

export interface PropertySymbol extends Symbol {
    kind: SymbolKind.Property;
    objectName: string;
    getterSyscall?: number;
    setterSyscall?: number;
    isInternal?: boolean;
}

export interface SyscallSymbol extends Symbol {
    kind: SymbolKind.Syscall;
    syscallNumber: number;
    syscallLib?: string;
    objectName?: string;
    isInternal?: boolean;
    parameters: VariableSymbol[];
    returnType?: DataType;
}

export interface EventSymbol extends Symbol {
    kind: SymbolKind.Event;
    eventNumber: number;
    parameters: VariableSymbol[];
}

export interface LabelSymbol extends Symbol {
    kind: SymbolKind.Label;
    address?: number;
    defined: boolean;
}

export type AnySymbol =
    | VariableSymbol
    | ConstantSymbol
    | FunctionSymbol
    | TypeSymbol
    | EnumSymbol
    | ObjectSymbol
    | PropertySymbol
    | SyscallSymbol
    | EventSymbol
    | LabelSymbol;

export class Scope {
    type: ScopeType;
    parent?: Scope;
    children: Scope[] = [];
    private symbols = new Map<string, AnySymbol>();
    startAddress = 0;
    endAddress = 0;
    loopEndLabel?: string; // for Exit Do/For/While
    ownerFunction?: FunctionSymbol;

    constructor(type: ScopeType, parent?: Scope) {
        this.type = type;
        this.parent = parent;
        if (parent) {
            parent.children.push(this);
            this.ownerFunction = parent.ownerFunction;
        }
    }

    define(symbol: AnySymbol): void {
        this.symbols.set(symbol.name.toLowerCase(), symbol);
    }

    lookupLocal(name: string): AnySymbol | undefined {
        return this.symbols.get(name.toLowerCase());
    }

    lookup(name: string): AnySymbol | undefined {
        const key = name.toLowerCase();
        const local = this.symbols.get(key);
        if (local) return local;
        return this.parent?.lookup(key);
    }

    getAllSymbols(): AnySymbol[] {
        return Array.from(this.symbols.values());
    }

    getVariables(): VariableSymbol[] {
        return this.getAllSymbols().filter(
            (s): s is VariableSymbol => s.kind === SymbolKind.Variable || s.kind === SymbolKind.Parameter
        );
    }
}

export class SymbolTable {
    globalScope: Scope;
    private currentScope: Scope;
    private allScopes: Scope[] = [];
    private allFunctions: FunctionSymbol[] = [];
    private allLabels: LabelSymbol[] = [];
    private allSyscalls: SyscallSymbol[] = [];

    constructor() {
        this.globalScope = new Scope(ScopeType.Global);
        this.currentScope = this.globalScope;
        this.allScopes.push(this.globalScope);
    }

    get current(): Scope {
        return this.currentScope;
    }

    pushScope(type: ScopeType): Scope {
        const scope = new Scope(type, this.currentScope);
        this.allScopes.push(scope);
        this.currentScope = scope;
        return scope;
    }

    popScope(): Scope {
        const old = this.currentScope;
        if (this.currentScope.parent) {
            this.currentScope = this.currentScope.parent;
        }
        return old;
    }

    define(symbol: AnySymbol): void {
        this.currentScope.define(symbol);
        if (symbol.kind === SymbolKind.Function || symbol.kind === SymbolKind.Sub) {
            this.allFunctions.push(symbol as FunctionSymbol);
        }
        if (symbol.kind === SymbolKind.Label) {
            this.allLabels.push(symbol as LabelSymbol);
        }
    }

    defineGlobal(symbol: AnySymbol): void {
        this.globalScope.define(symbol);
        if (symbol.kind === SymbolKind.Function || symbol.kind === SymbolKind.Sub) {
            this.allFunctions.push(symbol as FunctionSymbol);
        }
        if (symbol.kind === SymbolKind.Syscall) {
            this.allSyscalls.push(symbol as SyscallSymbol);
        }
    }

    lookup(name: string): AnySymbol | undefined {
        return this.currentScope.lookup(name);
    }

    lookupGlobal(name: string): AnySymbol | undefined {
        return this.globalScope.lookupLocal(name);
    }

    getScopes(): Scope[] {
        return this.allScopes;
    }

    getFunctions(): FunctionSymbol[] {
        return this.allFunctions;
    }

    getLabels(): LabelSymbol[] {
        return this.allLabels;
    }

    getSyscalls(): SyscallSymbol[] {
        return this.allSyscalls;
    }

    addSyscallEntry(sym: SyscallSymbol): void {
        this.allSyscalls.push(sym);
    }
}
