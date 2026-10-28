import type { ColumnInfo, DatabaseKind, FunctionInfo, TableInfo } from "@/lib/db";
import { BUILTIN_FUNCTIONS } from "./builtin-functions";
import { quoteIdent } from "./hover";
import { SQL_KEYWORDS } from "./keywords";
import { eq, findTable, isPackage } from "./resolve";
import { findRef, type QueryScope, scopeAt } from "./scope";
import type { SnippetLike, SqlObjectRegistry, Suggestion } from "./types";

function analyzeContext(textBeforeCursor: string): "table" | "column" | "general" {
  const upper = textBeforeCursor
    .slice(-2000)
    .replace(/[\w$#]+$/, "")
    .toUpperCase();
  const tablePatterns = [
    /\bFROM\b\s*(?:[\w".]+\s*,\s*)*$/,
    /\bJOIN\b\s*$/,
    /\bINTO\b\s*$/,
    /\bUPDATE\b\s*$/,
    /\bTABLE\b\s*$/,
    /\bTRUNCATE\b\s*$/,
  ];
  const columnPatterns = [
    /\b(?:SELECT|SET|RETURNING|BY)\b\s*(?:[\s\S]*,\s*)?$/,
    /\b(?:WHERE|HAVING)\b\s*(?:[\s\S]*\b(?:AND|OR)\b\s*)?$/,
    /\b(?:ON|AND|OR)\b\s*$/,
  ];
  if (tablePatterns.some((p) => p.test(upper))) return "table";
  if (columnPatterns.some((p) => p.test(upper))) return "column";
  return "general";
}

function derivedColumnSuggestions(
  names: string[],
  source: string,
  afterDot: boolean,
  dialect?: DatabaseKind,
): Suggestion[] {
  return names.map<Suggestion>((name) => ({
    label: name,
    kind: "column",
    detail: source,
    insertText: quoteIdent(name, dialect),
    sortText: `0_${name}`,
    afterDot,
  }));
}

function relationSuggestions(
  registry: SqlObjectRegistry,
  filter: (t: TableInfo) => boolean,
  qualified: boolean,
  afterDot: boolean,
  sortPrefix = afterDot ? 0 : 2,
): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (table: TableInfo, kind: "table" | "view") => {
    out.push({
      label: table.name,
      kind,
      detail: `${kind} · ${table.schema}`,
      insertText: quoteIdent(table.name, registry.dialect),
      sortText: `${sortPrefix}_${table.name}`,
      afterDot,
    });
    if (qualified) {
      out.push({
        label: `${table.schema}.${table.name}`,
        kind,
        detail: kind,
        insertText: `${quoteIdent(table.schema, registry.dialect)}.${quoteIdent(table.name, registry.dialect)}`,
        sortText: `1_${table.schema}_${table.name}`,
      });
    }
  };
  for (const table of registry.tables) if (filter(table)) push(table, "table");
  for (const view of registry.views) if (filter(view)) push(view, "view");
  return out;
}

function routineSuggestions(
  registry: SqlObjectRegistry,
  filter: (fn: FunctionInfo) => boolean,
  afterDot: boolean,
): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (fn: FunctionInfo, kind: "function" | "procedure") => {
    if (isPackage(fn)) {
      out.push({
        label: fn.name,
        kind: "package",
        detail: `package · ${fn.schema}`,
        insertText: quoteIdent(fn.name, registry.dialect),
        sortText: `${afterDot ? 0 : 2}_${fn.name}`,
        afterDot,
      });
      return;
    }
    const returns = kind === "function" && fn.return_type ? ` → ${fn.return_type}` : "";
    const name = quoteIdent(fn.name, registry.dialect);
    out.push({
      label: fn.name,
      kind,
      detail: `${fn.name}(${fn.identity_args})${returns} · ${fn.schema}`,
      insertText: fn.identity_args ? `${name.replace(/[$}\\]/g, "\\$&")}($0)` : name,
      snippet: Boolean(fn.identity_args),
      sortText: `${afterDot ? 0 : 2}_${fn.name}`,
      afterDot,
    });
  };
  for (const fn of registry.functions) if (filter(fn)) push(fn, "function");
  for (const proc of registry.procedures) if (filter(proc)) push(proc, "procedure");
  return out;
}

function columnSuggestion(
  column: ColumnInfo,
  sortText: string,
  afterDot: boolean,
  dialect?: DatabaseKind,
): Suggestion {
  return {
    label: column.name,
    kind: "column",
    detail: afterDot ? column.data_type : `${column.data_type} · ${column.schema}.${column.table}`,
    insertText: quoteIdent(column.name, dialect),
    sortText,
    afterDot,
  };
}

function columnSuggestions(
  columns: ColumnInfo[],
  sortText: (column: ColumnInfo) => string,
  afterDot: boolean,
  dialect?: DatabaseKind,
): Suggestion[] {
  return columns.map((column) => columnSuggestion(column, sortText(column), afterDot, dialect));
}

function sharedColumnSuggestion(columns: ColumnInfo[], dialect?: DatabaseKind): Suggestion {
  const [first] = columns;
  if (columns.length === 1) return columnSuggestion(first, `3_${first.name}`, false, dialect);
  const types = new Set<string>();
  for (const column of columns) types.add(column.data_type);
  const tables = columns.slice(0, 40).map((column) => `${column.schema}.${column.table}`);
  const remaining = columns.length - tables.length;
  return {
    label: first.name,
    kind: "column",
    detail: `${[...types].join(" | ")} · ${columns.length} Tabellen`,
    documentation:
      remaining > 0 ? `${tables.join("\n")}\n… ${remaining} weitere` : tables.join("\n"),
    insertText: quoteIdent(first.name, dialect),
    sortText: `3_${first.name}`,
    afterDot: false,
  };
}

interface RegistryIndex {
  dialect?: DatabaseKind;
  columnsByTable: Map<string, ColumnInfo[]>;
  columnGroups: { name: string; columns: ColumnInfo[]; suggestion: Suggestion }[];
  tableContext: Suggestion[];
  generalRelations: Suggestion[];
}

const registryIndexes = new WeakMap<SqlObjectRegistry, RegistryIndex>();

function registryIndex(registry: SqlObjectRegistry): RegistryIndex {
  const cached = registryIndexes.get(registry);
  if (cached) return cached;
  const columnsByTable = new Map<string, ColumnInfo[]>();
  const byName = new Map<string, ColumnInfo[]>();
  for (const column of registry.columns) {
    const key = column.table.toLowerCase();
    const list = columnsByTable.get(key);
    if (list) list.push(column);
    else columnsByTable.set(key, [column]);
    const group = byName.get(column.name);
    if (group) group.push(column);
    else byName.set(column.name, [column]);
  }
  const schemaSuggestion = (sortPrefix: string) =>
    registry.schemas.map<Suggestion>((schema) => ({
      label: schema,
      kind: "schema",
      detail: "schema",
      insertText: quoteIdent(schema, registry.dialect),
      sortText: `${sortPrefix}_${schema}`,
    }));
  const index: RegistryIndex = {
    dialect: registry.dialect,
    columnsByTable,
    columnGroups: [...byName].map(([name, columns]) => ({
      name,
      columns,
      suggestion: sharedColumnSuggestion(columns, registry.dialect),
    })),
    tableContext: [
      ...schemaSuggestion("0"),
      ...relationSuggestions(registry, () => true, true, false),
    ],
    generalRelations: [
      ...relationSuggestions(registry, () => true, false, false, 1),
      ...routineSuggestions(registry, () => true, false),
      ...schemaSuggestion("2"),
    ],
  };
  registryIndexes.set(registry, index);
  return index;
}

function generalColumnSuggestions(index: RegistryIndex, referenced: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  const touched = new Set<string>();
  for (const table of referenced) {
    for (const column of index.columnsByTable.get(table) ?? []) {
      out.push(columnSuggestion(column, `0_${column.name}`, false, index.dialect));
      touched.add(column.name);
    }
  }
  for (const group of index.columnGroups) {
    if (!touched.has(group.name)) {
      out.push(group.suggestion);
      continue;
    }
    const rest = group.columns.filter((column) => !referenced.has(column.table.toLowerCase()));
    if (rest.length > 0) out.push(sharedColumnSuggestion(rest, index.dialect));
  }
  return out;
}

const STATIC_SUGGESTIONS: Suggestion[] = [
  ...SQL_KEYWORDS.map<Suggestion>((keyword) => ({
    label: keyword,
    kind: "keyword",
    insertText: keyword,
    sortText: `4_${keyword}`,
  })),
  ...BUILTIN_FUNCTIONS.map<Suggestion>((fn) => ({
    label: fn.name,
    kind: "function",
    detail: fn.signature,
    insertText: `${fn.name}($0)`,
    snippet: true,
    sortText: `5_${fn.name}`,
  })),
];

export function suggestCompletions(
  registry: SqlObjectRegistry,
  textBeforeCursor: string,
  lineBeforeCursor: string,
  snippets: SnippetLike[] = [],
  scope: QueryScope = scopeAt(textBeforeCursor, textBeforeCursor.length, registry.dialect),
): Suggestion[] {
  const index = registryIndex(registry);
  const dialect = registry.dialect;
  const dotMatch = /"?([\w$#]+)"?\s*\.\s*[\w$#]*$/.exec(lineBeforeCursor);
  if (dotMatch) {
    const qualifier = dotMatch[1];
    const ref = findRef(scope, qualifier);
    if (ref?.columns) return derivedColumnSuggestions(ref.columns, ref.name, true, dialect);
    if (!ref && registry.schemas.some((schema) => eq(schema, qualifier))) {
      return [
        ...relationSuggestions(registry, (t) => eq(t.schema, qualifier), false, true),
        ...routineSuggestions(registry, (fn) => eq(fn.schema, qualifier), true),
      ];
    }
    const tableName = ref?.name ?? qualifier;
    const table = findTable(registry, tableName, ref?.schema ?? null);
    const candidates = index.columnsByTable.get(
      (table ? table.info.name : tableName).toLowerCase(),
    );
    const columns = table
      ? (candidates ?? []).filter((c) => eq(c.schema, table.info.schema))
      : (candidates ?? []);
    return columnSuggestions(columns, (c) => `0_${c.name}`, true, dialect);
  }

  let suggestions: Suggestion[];
  if (analyzeContext(textBeforeCursor) === "table") {
    suggestions = scope.ctes.map<Suggestion>((cte) => ({
      label: cte.name,
      kind: "table",
      detail: "CTE",
      documentation: cte.columns.join(", ") || undefined,
      insertText: quoteIdent(cte.name, dialect),
      sortText: `0_${cte.name}`,
    }));
    suggestions = suggestions.concat(index.tableContext);
  } else {
    const referenced = new Set<string>();
    suggestions = [];
    for (const ref of scope.tables) {
      if (ref.columns)
        suggestions.push(...derivedColumnSuggestions(ref.columns, ref.name, false, dialect));
      else referenced.add(ref.name.toLowerCase());
    }
    suggestions = suggestions.concat(
      generalColumnSuggestions(index, referenced),
      index.generalRelations,
    );
  }

  for (const snippet of snippets) {
    if (!snippet.shortcut.trim() || !snippet.body.trim()) continue;
    suggestions.push({
      label: snippet.shortcut,
      kind: "snippet",
      detail: snippet.category ? `${snippet.name} · ${snippet.category}` : snippet.name,
      documentation: snippet.description || undefined,
      filterText: `${snippet.shortcut} ${snippet.name}`,
      insertText: snippet.body,
      snippet: true,
      sortText: `0_${snippet.shortcut}`,
    });
  }

  for (const item of STATIC_SUGGESTIONS) suggestions.push(item);

  return suggestions;
}
