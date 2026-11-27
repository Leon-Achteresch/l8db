import type { ColumnInfo, DatabaseKind, FunctionInfo, TableInfo } from "@/lib/db";
import { toMonacoSnippet } from "@/lib/snippets";
import { BUILTIN_FUNCTIONS } from "./builtin-functions";
import { columnIndexes } from "./catalog";
import { CLICKHOUSE_FUNCTIONS } from "./clickhouse-functions";
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

function relationItem(
  table: TableInfo,
  kind: "table" | "view",
  insertText: string,
  sortPrefix: number,
  afterDot: boolean,
): Suggestion {
  return {
    label: table.name,
    kind,
    detail: `${kind} · ${table.schema}`,
    insertText,
    sortText: `${sortPrefix}_${table.name}`,
    afterDot,
  };
}

function relationSuggestions(
  registry: SqlObjectRegistry,
  filter: (t: TableInfo) => boolean,
  afterDot: boolean,
  sortPrefix = afterDot ? 0 : 2,
): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (table: TableInfo, kind: "table" | "view") => {
    out.push(
      relationItem(table, kind, quoteIdent(table.name, registry.dialect), sortPrefix, afterDot),
    );
  };
  for (const table of registry.tables) if (filter(table)) push(table, "table");
  for (const view of registry.views) if (filter(view)) push(view, "view");
  return out;
}

function routineItem(
  fn: FunctionInfo,
  kind: "function" | "procedure",
  dialect: DatabaseKind | undefined,
  afterDot: boolean,
): Suggestion {
  if (isPackage(fn)) {
    return {
      label: fn.name,
      kind: "package",
      detail: `package · ${fn.schema}`,
      insertText: quoteIdent(fn.name, dialect),
      sortText: `${afterDot ? 0 : 2}_${fn.name}`,
      afterDot,
    };
  }
  const returns = kind === "function" && fn.return_type ? ` → ${fn.return_type}` : "";
  const name = quoteIdent(fn.name, dialect);
  return {
    label: fn.name,
    kind,
    detail: `${fn.name}(${fn.identity_args})${returns} · ${fn.schema}`,
    insertText: fn.identity_args ? `${name.replace(/[$}\\]/g, "\\$&")}($0)` : name,
    snippet: Boolean(fn.identity_args),
    sortText: `${afterDot ? 0 : 2}_${fn.name}`,
    afterDot,
  };
}
function routineSuggestions(
  registry: SqlObjectRegistry,
  filter: (fn: FunctionInfo) => boolean,
  afterDot: boolean,
): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (fn: FunctionInfo, kind: "function" | "procedure") =>
    out.push(routineItem(fn, kind, registry.dialect, afterDot));
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

function sharedColumnSuggestion(
  columns: ColumnInfo[],
  dialect?: DatabaseKind,
  knownTypes?: string,
): Suggestion {
  const [first] = columns;
  if (columns.length === 1) return columnSuggestion(first, `3_${first.name}`, false, dialect);
  let types = knownTypes;
  if (types === undefined) {
    const distinct = new Set<string>();
    for (const column of columns) distinct.add(column.data_type);
    types = [...distinct].join(" | ");
  }
  const tables = columns.slice(0, 40).map((column) => `${column.schema}.${column.table}`);
  const remaining = columns.length - tables.length;
  return {
    label: first.name,
    kind: "column",
    detail: `${types} · ${columns.length} Tabellen`,
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

type Build = Generator<void, RegistryIndex>;
const pending = new WeakMap<SqlObjectRegistry, Build>();
const indexedColumns = new WeakMap<
  ColumnInfo[],
  Pick<RegistryIndex, "columnGroups" | "columnsByTable" | "dialect">
>();
const relationLists = new WeakMap<
  TableInfo[],
  { dialect?: DatabaseKind; kind: string; table: Suggestion[]; general: Suggestion[] }
>();

function* buildRegistryIndex(registry: SqlObjectRegistry): Build {
  const dialect = registry.dialect;
  let columns = indexedColumns.get(registry.columns);
  if (!columns || columns.dialect !== dialect) {
    const existing = columnIndexes.get(registry.columns);
    const byTable = existing ?? new Map<string, ColumnInfo[]>();
    const groups = new Map<string, { columns: ColumnInfo[]; types?: Set<string> }>();
    let lastTable: string | undefined;
    let bucket: ColumnInfo[] = [];
    let n = 0;
    for (const column of registry.columns) {
      if (!existing) {
        if (lastTable !== column.table) {
          lastTable = column.table;
          const folded = lastTable.toLowerCase();
          bucket = byTable.get(folded) ?? [];
          byTable.set(folded, bucket);
        }
        bucket.push(column);
      }
      const group = groups.get(column.name);
      if (group) {
        group.columns.push(column);
        if (column.data_type !== group.columns[0].data_type) {
          group.types ??= new Set([group.columns[0].data_type]);
          group.types.add(column.data_type);
        }
      } else groups.set(column.name, { columns: [column] });
      if (++n % 512 === 0) yield;
    }
    const columnGroups: RegistryIndex["columnGroups"] = [];
    for (const [name, group] of groups) {
      columnGroups.push({
        name,
        columns: group.columns,
        suggestion: sharedColumnSuggestion(
          group.columns,
          dialect,
          group.types ? [...group.types].join(" | ") : group.columns[0].data_type,
        ),
      });
      if (++n % 128 === 0) yield;
    }
    columns = { dialect, columnsByTable: byTable, columnGroups };
    if (!existing) columnIndexes.set(registry.columns, byTable);
    indexedColumns.set(registry.columns, columns);
  }
  const schemaSuggestion = (schema: string, sortPrefix: string): Suggestion => ({
    label: schema,
    kind: "schema",
    detail: "schema",
    insertText: quoteIdent(schema, dialect),
    sortText: `${sortPrefix}_${schema}`,
  });
  const tableContext: Suggestion[] = [];
  const generalRelations: Suggestion[] = [];
  let n = 0;
  for (const schema of registry.schemas) {
    tableContext.push(schemaSuggestion(schema, "0"));
    if (++n % 128 === 0) yield;
  }
  for (const kind of ["table", "view"] as const) {
    const rows = kind === "table" ? registry.tables : registry.views;
    let list = relationLists.get(rows);
    if (!list || list.kind !== kind || list.dialect !== dialect) {
      list = { dialect, kind, table: [], general: [] };
      let owner: string | undefined;
      let quotedOwner = "";
      for (const row of rows) {
        const quoted = quoteIdent(row.name, dialect);
        if (owner !== row.schema) {
          owner = row.schema;
          quotedOwner = quoteIdent(owner, dialect);
        }
        list.table.push(relationItem(row, kind, quoted, 2, false), {
          label: `${row.schema}.${row.name}`,
          kind,
          detail: kind,
          insertText: `${quotedOwner}.${quoted}`,
          sortText: `1_${row.schema}_${row.name}`,
        });
        list.general.push(relationItem(row, kind, quoted, 1, false));
        if (++n % 128 === 0) yield;
      }
      relationLists.set(rows, list);
    }
    for (const item of list.table) {
      tableContext.push(item);
      if (++n % 1024 === 0) yield;
    }
    for (const item of list.general) {
      generalRelations.push(item);
      if (++n % 1024 === 0) yield;
    }
  }
  for (const kind of ["function", "procedure"] as const) {
    for (const fn of kind === "function" ? registry.functions : registry.procedures) {
      generalRelations.push(routineItem(fn, kind, dialect, false));
      if (++n % 128 === 0) yield;
    }
  }
  for (const schema of registry.schemas) {
    generalRelations.push(schemaSuggestion(schema, "2"));
    if (++n % 128 === 0) yield;
  }
  const index = { ...columns, tableContext, generalRelations };
  registryIndexes.set(registry, index);
  pending.delete(registry);
  return index;
}

function builder(registry: SqlObjectRegistry) {
  let build = pending.get(registry);
  if (!build) {
    build = buildRegistryIndex(registry);
    pending.set(registry, build);
  }
  return build;
}

function registryIndex(registry: SqlObjectRegistry): RegistryIndex {
  const cached = registryIndexes.get(registry);
  if (cached) return cached;
  const build = builder(registry);
  let result = build.next();
  while (!result.done) result = build.next();
  return result.value;
}

export function cancelCompletionPreparation(registry: SqlObjectRegistry): void {
  pending.delete(registry);
}

export function prepareCompletionSlice(registry: SqlObjectRegistry): boolean {
  if (registryIndexes.has(registry)) return true;
  const build = builder(registry);
  const end = performance.now() + 2;
  do {
    if (build.next().done) return true;
  } while (performance.now() < end);
  return false;
}

const generalColumns = new WeakMap<RegistryIndex, { key: string; items: Suggestion[] }>();

export function prepareCompletions(registry: SqlObjectRegistry): void {
  registryIndex(registry);
}

function generalColumnSuggestions(index: RegistryIndex, referenced: Set<string>): Suggestion[] {
  const key = [...referenced].join("\0");
  const cached = generalColumns.get(index);
  if (cached?.key === key) return cached.items;
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
  generalColumns.set(index, { key, items: out });
  return out;
}

const KEYWORD_SUGGESTIONS = SQL_KEYWORDS.map<Suggestion>((keyword) => ({
  label: keyword,
  kind: "keyword",
  insertText: keyword,
  sortText: `4_${keyword}`,
}));

const functionSuggestions = (functions: { name: string; signature: string }[]) =>
  functions.map<Suggestion>((fn) => ({
    label: fn.name,
    kind: "function",
    detail: fn.signature,
    insertText: `${fn.name}($0)`,
    snippet: true,
    sortText: `5_${fn.name}`,
  }));

const STATIC_SUGGESTIONS: Suggestion[] = [
  ...KEYWORD_SUGGESTIONS,
  ...functionSuggestions(BUILTIN_FUNCTIONS),
];

const CLICKHOUSE_SUGGESTIONS: Suggestion[] = [
  ...KEYWORD_SUGGESTIONS,
  ...functionSuggestions(CLICKHOUSE_FUNCTIONS),
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
        ...relationSuggestions(registry, (t) => eq(t.schema, qualifier), true),
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
      insertText: toMonacoSnippet(snippet.body),
      snippet: true,
      sortText: `0_${snippet.shortcut}`,
    });
  }

  for (const item of dialect === "clickhouse" ? CLICKHOUSE_SUGGESTIONS : STATIC_SUGGESTIONS)
    suggestions.push(item);

  return suggestions;
}
