export interface SourceLocation {
    file: string;
    line: number;
    column: number;
}

export enum DiagnosticSeverity {
    Error = 'error',
    Warning = 'warning',
    Info = 'info',
}

export interface Diagnostic {
    severity: DiagnosticSeverity;
    location: SourceLocation;
    message: string;
    code?: string;
}

export class CompilerError extends Error {
    constructor(
        message: string,
        public location: SourceLocation,
        public code?: string,
    ) {
        super(`${location.file}:${location.line}:${location.column}: ${message}`);
        this.name = 'CompilerError';
    }
}

export class DiagnosticCollection {
    private diagnostics: Diagnostic[] = [];

    error(location: SourceLocation, message: string, code?: string): void {
        this.diagnostics.push({ severity: DiagnosticSeverity.Error, location, message, code });
    }

    warning(location: SourceLocation, message: string, code?: string): void {
        this.diagnostics.push({ severity: DiagnosticSeverity.Warning, location, message, code });
    }

    info(location: SourceLocation, message: string, code?: string): void {
        this.diagnostics.push({ severity: DiagnosticSeverity.Info, location, message, code });
    }

    getErrors(): Diagnostic[] {
        return this.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
    }

    getWarnings(): Diagnostic[] {
        return this.diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning);
    }

    getAll(): Diagnostic[] {
        return [...this.diagnostics];
    }

    hasErrors(): boolean {
        return this.diagnostics.some(d => d.severity === DiagnosticSeverity.Error);
    }

    clear(): void {
        this.diagnostics = [];
    }
}
