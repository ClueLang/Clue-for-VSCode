export interface Symbols {
    definitions: ClueSymbolDefinition[];
    uses: ClueSymbolUse[];
    diagnostics: ClueDiagnostic[];
}

export interface ClueDiagnostic {
    level: ClueDiagnosticLevel;
    message: string;
    location: Range;
}

export type ClueDiagnosticLevel =
| 'WARNING'
| 'ERROR';

export interface ClueSymbolDefinition {
    id: number;
    token: string;
    value: string | null;
    location: Range;
    kind: ClueSymbolKind;
    modifiers: ClueSymbolModifier[];
}

export interface ClueSymbolUse {
    definitionId: number | null;
    location: Range;
}

export type ClueSymbolKind =
| 'VARIABLE'
| 'FUNCTION'
| 'PSEUDO'
| 'ENUM'
| 'CONSTANT'
| 'MACRO'
| 'ARGUMENT';

export type ClueSymbolModifier =
| 'LOCAL'
| 'GLOBAL'
| 'STATIC';

export interface Range {
    start: Position;
    end: Position;
}

export interface Position {
    line: number;
    character: number;
}
