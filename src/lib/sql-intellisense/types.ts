import type { ColumnInfo, FunctionInfo, TableInfo } from "@/lib/db";
import type { PlsqlMember } from "@/lib/plsql";

export interface SqlObjectRegistry {
  schemas: string[];
  tables: TableInfo[];
  views: TableInfo[];
  columns: ColumnInfo[];
  functions: FunctionInfo[];
  procedures: FunctionInfo[];
}

export const EMPTY_REGISTRY: SqlObjectRegistry = {
  schemas: [],
  tables: [],
  views: [],
  columns: [],
  functions: [],
  procedures: [],
};

export interface SqlToken {
  word: string;
  qualifier: string | null;
  startColumn: number;
  endColumn: number;
}

export type SymbolTarget =
  | { kind: "local"; name: string; line: number; memberKind: PlsqlMember["kind"] }
  | { kind: "function" | "procedure"; schema: string; name: string; oid: string }
  | { kind: "package"; schema: string; name: string; member?: string }
  | {
      kind: "table";
      schema: string;
      name: string;
      entityType: "table" | "view";
      column?: string;
      sql?: string;
    };

export type SuggestionKind =
  | "schema"
  | "table"
  | "view"
  | "column"
  | "function"
  | "procedure"
  | "package"
  | "keyword"
  | "snippet";

export interface Suggestion {
  label: string;
  kind: SuggestionKind;
  insertText: string;
  sortText: string;
  detail?: string;
  documentation?: string;
  filterText?: string;
  snippet?: boolean;
  afterDot?: boolean;
}

export interface SnippetLike {
  shortcut: string;
  name: string;
  category?: string;
  description?: string;
  body: string;
}
