import type { ColumnInfo, FunctionInfo, TableInfo } from "@/lib/db";
import { BUILTIN_FUNCTIONS } from "./builtin-functions";
import { quoteIdent } from "./hover";
import { SQL_KEYWORDS } from "./keywords";
import { aliasMap, eq, findTable, isPackage } from "./resolve";
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

function referencedTableNames(textBeforeCursor: string): Set<string> {
  const names = new Set<string>();
  for (const match of textBeforeCursor.matchAll(/(?:FROM|JOIN)\s+([\w"$#]+(?:\.[\w"$#]+)?)/gi)) {
    const ref = match[1].replace(/"/g, "");
    names.add((ref.includes(".") ? ref.split(".")[1] : ref).toLowerCase());
  }
  for (const [alias] of aliasMap(textBeforeCursor)) names.add(alias);
  return names;
}

function relationSuggestions(
  registry: SqlObjectRegistry,
  filter: (t: TableInfo) => boolean,
  qualified: boolean,
  afterDot: boolean,
): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (table: TableInfo, kind: "table" | "view") => {
    out.push({
      label: table.name,
      kind,
      detail: `${kind} · ${table.schema}`,
      insertText: quoteIdent(table.name),
      sortText: `${afterDot ? 0 : 2}_${table.name}`,
      afterDot,
    });
    if (qualified) {
      out.push({
        label: `${table.schema}.${table.name}`,
        kind,
        detail: kind,
        insertText: `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`,
        sortText: `1_${table.schema}_${table.name}`,
      });
    }
  };
  for (const table of registry.tables.filter(filter)) push(table, "table");
  for (const view of registry.views.filter(filter)) push(view, "view");
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
        insertText: fn.name,
        sortText: `${afterDot ? 0 : 2}_${fn.name}`,
        afterDot,
      });
      return;
    }
    const returns = kind === "function" && fn.return_type ? ` → ${fn.return_type}` : "";
    out.push({
      label: fn.name,
      kind,
      detail: `${fn.name}(${fn.identity_args})${returns} · ${fn.schema}`,
      insertText: fn.identity_args ? `${fn.name}($0)` : fn.name,
      snippet: Boolean(fn.identity_args),
      sortText: `${afterDot ? 0 : 2}_${fn.name}`,
      afterDot,
    });
  };
  for (const fn of registry.functions.filter(filter)) push(fn, "function");
  for (const proc of registry.procedures.filter(filter)) push(proc, "procedure");
  return out;
}

function columnSuggestion(column: ColumnInfo, sortText: string, afterDot: boolean): Suggestion {
  return {
    label: column.name,
    kind: "column",
    detail: afterDot ? column.data_type : `${column.data_type} · ${column.schema}.${column.table}`,
    insertText: quoteIdent(column.name),
    sortText,
    afterDot,
  };
}

function columnSuggestions(
  columns: ColumnInfo[],
  sortText: (column: ColumnInfo) => string,
  afterDot: boolean,
): Suggestion[] {
  return columns.map((column) => columnSuggestion(column, sortText(column), afterDot));
}

function sharedColumnSuggestion(columns: ColumnInfo[]): Suggestion {
  const [first] = columns;
  if (columns.length === 1) return columnSuggestion(first, `3_${first.name}`, false);
  const types = [...new Set(columns.map((column) => column.data_type))].join(" | ");
  const tables = columns.map((column) => `${column.schema}.${column.table}`);
  return {
    label: first.name,
    kind: "column",
    detail: `${types} · ${columns.length} Tabellen`,
    documentation:
      tables.length > 40
        ? `${tables.slice(0, 40).join("\n")}\n… ${tables.length - 40} weitere`
        : tables.join("\n"),
    insertText: quoteIdent(first.name),
    sortText: `3_${first.name}`,
    afterDot: false,
  };
}

interface RegistryIndex {
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
      insertText: quoteIdent(schema),
      sortText: `${sortPrefix}_${schema}`,
    }));
  const index: RegistryIndex = {
    columnsByTable,
    columnGroups: [...byName].map(([name, columns]) => ({
      name,
      columns,
      suggestion: sharedColumnSuggestion(columns),
    })),
    tableContext: [
      ...schemaSuggestion("0"),
      ...relationSuggestions(registry, () => true, true, false),
    ],
    generalRelations: [
      ...relationSuggestions(registry, () => true, false, false).map((s) => ({
        ...s,
        sortText: `1_${s.label}`,
      })),
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
      out.push(columnSuggestion(column, `0_${column.name}`, false));
      touched.add(column.name);
    }
  }
  for (const group of index.columnGroups) {
    if (!touched.has(group.name)) {
      out.push(group.suggestion);
      continue;
    }
    const rest = group.columns.filter((column) => !referenced.has(column.table.toLowerCase()));
    if (rest.length > 0) out.push(sharedColumnSuggestion(rest));
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
): Suggestion[] {
  const index = registryIndex(registry);
  const dotMatch = /"?([\w$#]+)"?\s*\.\s*[\w$#]*$/.exec(lineBeforeCursor);
  if (dotMatch) {
    const qualifier = dotMatch[1];
    if (registry.schemas.some((schema) => eq(schema, qualifier))) {
      return [
        ...relationSuggestions(registry, (t) => eq(t.schema, qualifier), false, true),
        ...routineSuggestions(registry, (fn) => eq(fn.schema, qualifier), true),
      ];
    }
    const tableName = aliasMap(textBeforeCursor).get(qualifier.toLowerCase()) ?? qualifier;
    const table = findTable(registry, tableName, null);
    const candidates = index.columnsByTable.get(
      (table ? table.info.name : tableName).toLowerCase(),
    );
    const columns = table
      ? (candidates ?? []).filter((c) => eq(c.schema, table.info.schema))
      : (candidates ?? []);
    return columnSuggestions(columns, (c) => `0_${c.name}`, true);
  }

  const context = analyzeContext(textBeforeCursor);
  const suggestions: Suggestion[] =
    context === "table"
      ? [...index.tableContext]
      : [
          ...generalColumnSuggestions(index, referencedTableNames(textBeforeCursor)),
          ...index.generalRelations,
        ];

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
