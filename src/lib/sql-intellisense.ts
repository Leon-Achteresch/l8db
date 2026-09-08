import type { ColumnInfo, FunctionInfo, TableInfo } from "@/lib/db";
import { type PlsqlMember, parsePlsqlMembers } from "@/lib/plsql";

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

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isPackage = (fn: FunctionInfo) => fn.return_type === "PACKAGE";

export function tokenAt(line: string, column: number): SqlToken | null {
  for (const match of line.matchAll(/[\w$#]+/g)) {
    const startColumn = match.index + 1;
    const endColumn = startColumn + match[0].length;
    if (column < startColumn) return null;
    if (column > endColumn) continue;
    const qualifier = /"?([\w$#]+)"?\s*\.\s*$/.exec(line.slice(0, match.index));
    return { word: match[0], qualifier: qualifier ? qualifier[1] : null, startColumn, endColumn };
  }
  return null;
}

export function aliasMap(text: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const pattern =
    /(?:FROM|JOIN|UPDATE|INTO)\s+([\w"$#]+(?:\.[\w"$#]+)?)(?:\s+(?:AS\s+)?([\w$#]+))?/gi;
  for (const match of text.matchAll(pattern)) {
    const alias = match[2];
    if (
      !alias ||
      /^(WHERE|ON|SET|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|GROUP|ORDER|LIMIT|USING|VALUES|SELECT)$/i.test(
        alias,
      )
    )
      continue;
    const ref = match[1].replace(/"/g, "");
    aliases.set(alias.toLowerCase(), ref.includes(".") ? ref.split(".")[1] : ref);
  }
  return aliases;
}

function findTable(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): { info: TableInfo; entityType: "table" | "view" } | null {
  const inSchema = (t: TableInfo) => eq(t.name, name) && (!schema || eq(t.schema, schema));
  const table = registry.tables.find(inSchema);
  if (table) return { info: table, entityType: "table" };
  const view = registry.views.find(inSchema);
  return view ? { info: view, entityType: "view" } : null;
}

function findRoutine(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): SymbolTarget | null {
  const inSchema = (fn: FunctionInfo) => eq(fn.name, name) && (!schema || eq(fn.schema, schema));
  const pkg = registry.functions.find((fn) => isPackage(fn) && inSchema(fn));
  if (pkg) return { kind: "package", schema: pkg.schema, name: pkg.name };
  const fn = registry.functions.find((entry) => !isPackage(entry) && inSchema(entry));
  if (fn) return { kind: "function", schema: fn.schema, name: fn.name, oid: fn.oid };
  const proc = registry.procedures.find(inSchema);
  if (proc) return { kind: "procedure", schema: proc.schema, name: proc.name, oid: proc.oid };
  return null;
}

function findObject(
  registry: SqlObjectRegistry,
  name: string,
  schema: string | null,
): SymbolTarget | null {
  const routine = findRoutine(registry, name, schema);
  if (routine) return routine;
  const table = findTable(registry, name, schema);
  if (table) {
    return {
      kind: "table",
      schema: table.info.schema,
      name: table.info.name,
      entityType: table.entityType,
    };
  }
  return null;
}

export function resolveSymbol(
  registry: SqlObjectRegistry,
  token: SqlToken,
  source = "",
): SymbolTarget | null {
  if (token.qualifier) {
    const qualifier = token.qualifier;
    const pkg = registry.functions.find((fn) => isPackage(fn) && eq(fn.name, qualifier));
    if (pkg) {
      return {
        kind: "package",
        schema: pkg.schema,
        name: pkg.name,
        member: token.word.toUpperCase(),
      };
    }
    if (registry.schemas.some((schema) => eq(schema, qualifier))) {
      return findObject(registry, token.word, qualifier);
    }
    const tableName = aliasMap(source).get(qualifier.toLowerCase()) ?? qualifier;
    const table = findTable(registry, tableName, null);
    if (!table) return null;
    const column = registry.columns.find(
      (c) =>
        eq(c.schema, table.info.schema) && eq(c.table, table.info.name) && eq(c.name, token.word),
    );
    if (!column) return null;
    return {
      kind: "table",
      schema: table.info.schema,
      name: table.info.name,
      entityType: table.entityType,
      column: column.name,
    };
  }
  const local = parsePlsqlMembers(source).find((m) => m.name === token.word.toUpperCase());
  if (local) return { kind: "local", name: local.name, line: local.line, memberKind: local.kind };
  return findObject(registry, token.word, null);
}

export function packageForQualifier(
  registry: SqlObjectRegistry,
  lineBeforeCursor: string,
): FunctionInfo | null {
  const match = /"?([\w$#]+)"?\s*\.\s*[\w$#]*$/.exec(lineBeforeCursor);
  if (!match) return null;
  return registry.functions.find((fn) => isPackage(fn) && eq(fn.name, match[1])) ?? null;
}

export function memberSuggestions(members: PlsqlMember[]): Suggestion[] {
  return members.map((member) => ({
    label: member.name,
    kind: member.kind === "FUNCTION" ? "function" : "procedure",
    detail: member.kind,
    insertText: member.name,
    sortText: `0_${member.name}`,
    afterDot: true,
  }));
}

function truncate(value: unknown, max = 40): string {
  const text = String(value ?? "NULL")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function rowsMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return "";
  const header = `| ${columns.map((c) => truncate(c)).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((c) => truncate(row[c])).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export interface HoverExtras {
  members?: PlsqlMember[];
  rows?: { columns: string[]; rows: Record<string, unknown>[] };
  routine?: FunctionInfo;
}

export function hoverMarkdown(
  registry: SqlObjectRegistry,
  target: SymbolTarget,
  extras: HoverExtras = {},
): string {
  if (target.kind === "local") {
    return `**${target.memberKind} ${target.name}** · Zeile ${target.line}`;
  }
  if (target.kind === "package") {
    if (target.member) {
      const member = extras.members?.find((m) => m.name === target.member);
      return member
        ? `**${member.kind} ${target.schema}.${target.name}.${member.name}**`
        : `**${target.schema}.${target.name}.${target.member}** · Package-Member`;
    }
    const members = (extras.members ?? []).map((m) => `- ${m.kind} \`${m.name}\``);
    return [`**PACKAGE ${target.schema}.${target.name}**`, ...members].join("\n");
  }
  if (target.kind !== "table") {
    const info = extras.routine;
    const signature = `${target.schema}.${target.name}(${info?.identity_args ?? ""})`;
    const returns =
      target.kind === "function" && info?.return_type ? ` RETURNS ${info.return_type}` : "";
    const head = `\`\`\`sql\n${target.kind.toUpperCase()} ${signature}${returns}\n\`\`\``;
    return info?.language ? `${head}\n${info.language}` : head;
  }
  if (target.kind !== "table") return "";
  const columns = registry.columns.filter(
    (c) => eq(c.schema, target.schema) && eq(c.table, target.name),
  );
  if (target.column) {
    const column = columns.find((c) => eq(c.name, target.column ?? ""));
    return `**${target.schema}.${target.name}.${target.column}** · ${column?.data_type ?? "Spalte"}`;
  }
  const lines = [`**${target.schema}.${target.name}** · ${target.entityType}`];
  for (const column of columns.slice(0, 40)) lines.push(`- \`${column.name}\` ${column.data_type}`);
  if (columns.length > 40) lines.push(`- … ${columns.length - 40} weitere`);
  if (extras.rows) {
    const table = rowsMarkdownTable(extras.rows.columns, extras.rows.rows);
    if (table) lines.push("", table);
  }
  return lines.join("\n");
}

export function quoteIdent(name: string): string {
  const plain = /^[a-z_][a-z0-9_$#]*$/.test(name) || /^[A-Z_][A-Z0-9_$#]*$/.test(name);
  return plain ? name : `"${name.replace(/"/g, '""')}"`;
}

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

function columnSuggestions(
  columns: ColumnInfo[],
  sortText: (column: ColumnInfo) => string,
  afterDot: boolean,
): Suggestion[] {
  return columns.map((column) => ({
    label: column.name,
    kind: "column",
    detail: afterDot ? column.data_type : `${column.data_type} · ${column.schema}.${column.table}`,
    insertText: quoteIdent(column.name),
    sortText: sortText(column),
    afterDot,
  }));
}

export function suggestCompletions(
  registry: SqlObjectRegistry,
  textBeforeCursor: string,
  lineBeforeCursor: string,
  snippets: SnippetLike[] = [],
): Suggestion[] {
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
    const columns = table
      ? registry.columns.filter(
          (c) => eq(c.schema, table.info.schema) && eq(c.table, table.info.name),
        )
      : registry.columns.filter((c) => eq(c.table, tableName));
    return columnSuggestions(columns, (c) => `0_${c.name}`, true);
  }

  const context = analyzeContext(textBeforeCursor);
  const suggestions: Suggestion[] = [];
  const schemaSuggestion = (sortPrefix: string) =>
    registry.schemas.map<Suggestion>((schema) => ({
      label: schema,
      kind: "schema",
      detail: "schema",
      insertText: quoteIdent(schema),
      sortText: `${sortPrefix}_${schema}`,
    }));

  if (context === "table") {
    suggestions.push(...schemaSuggestion("0"));
    suggestions.push(...relationSuggestions(registry, () => true, true, false));
  } else {
    const referenced = referencedTableNames(textBeforeCursor);
    suggestions.push(
      ...columnSuggestions(
        registry.columns,
        (c) => (referenced.has(c.table.toLowerCase()) ? `0_${c.name}` : `3_${c.name}`),
        false,
      ),
    );
    suggestions.push(
      ...relationSuggestions(registry, () => true, false, false).map((s) => ({
        ...s,
        sortText: `1_${s.label}`,
      })),
    );
    suggestions.push(...routineSuggestions(registry, () => true, false));
    suggestions.push(...schemaSuggestion("2"));
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

  for (const keyword of SQL_KEYWORDS) {
    suggestions.push({
      label: keyword,
      kind: "keyword",
      insertText: keyword,
      sortText: `4_${keyword}`,
    });
  }

  for (const fn of BUILTIN_FUNCTIONS) {
    suggestions.push({
      label: fn.name,
      kind: "function",
      detail: fn.signature,
      insertText: `${fn.name}($0)`,
      snippet: true,
      sortText: `5_${fn.name}`,
    });
  }

  return suggestions;
}

export const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "SCHEMA",
  "DATABASE",
  "SEQUENCE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "RENAME",
  "TO",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "FULL OUTER JOIN",
  "CROSS JOIN",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "ON",
  "USING",
  "AS",
  "DISTINCT",
  "ALL",
  "ANY",
  "SOME",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "INTERSECT",
  "EXCEPT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "WITH",
  "RECURSIVE",
  "RETURNING",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "EXPLAIN",
  "EXPLAIN ANALYZE",
  "OVER",
  "PARTITION BY",
  "WINDOW",
  "ON CONFLICT",
  "DO NOTHING",
  "DO UPDATE",
  "LATERAL",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "NOT NULL",
  "CASCADE",
  "RESTRICT",
  "INTEGER",
  "INT",
  "BIGINT",
  "SMALLINT",
  "SERIAL",
  "BIGSERIAL",
  "TEXT",
  "VARCHAR",
  "CHAR",
  "BOOLEAN",
  "BOOL",
  "FLOAT",
  "REAL",
  "DOUBLE PRECISION",
  "NUMERIC",
  "DECIMAL",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "TIMESTAMP WITH TIME ZONE",
  "INTERVAL",
  "JSON",
  "JSONB",
  "UUID",
  "BYTEA",
  "ARRAY",
  "TRUE",
  "FALSE",
  "NULL",
  "DECLARE",
  "IS",
  "LOOP",
  "END LOOP",
  "IF",
  "ELSIF",
  "END IF",
  "EXCEPTION",
  "RAISE",
  "RETURN",
  "CURSOR",
  "PROCEDURE",
  "FUNCTION",
  "PACKAGE",
  "PACKAGE BODY",
];

export const BUILTIN_FUNCTIONS: { name: string; signature: string }[] = [
  { name: "COUNT", signature: "COUNT(expression)" },
  { name: "SUM", signature: "SUM(expression)" },
  { name: "AVG", signature: "AVG(expression)" },
  { name: "MIN", signature: "MIN(expression)" },
  { name: "MAX", signature: "MAX(expression)" },
  { name: "ARRAY_AGG", signature: "ARRAY_AGG(expression)" },
  { name: "STRING_AGG", signature: "STRING_AGG(expression, delimiter)" },
  { name: "LISTAGG", signature: "LISTAGG(expression, delimiter) WITHIN GROUP (ORDER BY ...)" },
  { name: "JSON_AGG", signature: "JSON_AGG(expression)" },
  { name: "JSONB_AGG", signature: "JSONB_AGG(expression)" },
  { name: "ROW_NUMBER", signature: "ROW_NUMBER()" },
  { name: "RANK", signature: "RANK()" },
  { name: "DENSE_RANK", signature: "DENSE_RANK()" },
  { name: "LAG", signature: "LAG(expression, offset, default)" },
  { name: "LEAD", signature: "LEAD(expression, offset, default)" },
  { name: "FIRST_VALUE", signature: "FIRST_VALUE(expression)" },
  { name: "LAST_VALUE", signature: "LAST_VALUE(expression)" },
  { name: "NTH_VALUE", signature: "NTH_VALUE(expression, n)" },
  { name: "NTILE", signature: "NTILE(n)" },
  { name: "PERCENT_RANK", signature: "PERCENT_RANK()" },
  { name: "CUME_DIST", signature: "CUME_DIST()" },
  { name: "LENGTH", signature: "LENGTH(string)" },
  { name: "LOWER", signature: "LOWER(string)" },
  { name: "UPPER", signature: "UPPER(string)" },
  { name: "TRIM", signature: "TRIM(string)" },
  { name: "LTRIM", signature: "LTRIM(string)" },
  { name: "RTRIM", signature: "RTRIM(string)" },
  { name: "CONCAT", signature: "CONCAT(val1, val2, ...)" },
  { name: "CONCAT_WS", signature: "CONCAT_WS(separator, val1, val2, ...)" },
  { name: "SUBSTRING", signature: "SUBSTRING(string FROM start FOR length)" },
  { name: "SUBSTR", signature: "SUBSTR(string, start, length)" },
  { name: "INSTR", signature: "INSTR(string, substring)" },
  { name: "REPLACE", signature: "REPLACE(string, from, to)" },
  { name: "REGEXP_REPLACE", signature: "REGEXP_REPLACE(string, pattern, replacement)" },
  { name: "REGEXP_MATCH", signature: "REGEXP_MATCH(string, pattern)" },
  { name: "SPLIT_PART", signature: "SPLIT_PART(string, delimiter, n)" },
  { name: "POSITION", signature: "POSITION(substring IN string)" },
  { name: "STRPOS", signature: "STRPOS(string, substring)" },
  { name: "INITCAP", signature: "INITCAP(string)" },
  { name: "REPEAT", signature: "REPEAT(string, n)" },
  { name: "REVERSE", signature: "REVERSE(string)" },
  { name: "LPAD", signature: "LPAD(string, length, fill)" },
  { name: "RPAD", signature: "RPAD(string, length, fill)" },
  { name: "FORMAT", signature: "FORMAT(format, ...)" },
  { name: "STARTS_WITH", signature: "STARTS_WITH(string, prefix)" },
  { name: "ABS", signature: "ABS(x)" },
  { name: "CEIL", signature: "CEIL(x)" },
  { name: "FLOOR", signature: "FLOOR(x)" },
  { name: "ROUND", signature: "ROUND(x, decimal_places)" },
  { name: "TRUNC", signature: "TRUNC(x, decimal_places)" },
  { name: "SIGN", signature: "SIGN(x)" },
  { name: "POWER", signature: "POWER(base, exponent)" },
  { name: "SQRT", signature: "SQRT(x)" },
  { name: "EXP", signature: "EXP(x)" },
  { name: "LN", signature: "LN(x)" },
  { name: "LOG", signature: "LOG(base, x)" },
  { name: "MOD", signature: "MOD(dividend, divisor)" },
  { name: "RANDOM", signature: "RANDOM()" },
  { name: "PI", signature: "PI()" },
  { name: "NOW", signature: "NOW()" },
  { name: "SYSDATE", signature: "SYSDATE" },
  { name: "SYSTIMESTAMP", signature: "SYSTIMESTAMP" },
  { name: "CURRENT_DATE", signature: "CURRENT_DATE" },
  { name: "CURRENT_TIME", signature: "CURRENT_TIME" },
  { name: "CURRENT_TIMESTAMP", signature: "CURRENT_TIMESTAMP" },
  { name: "DATE_PART", signature: "DATE_PART('field', source)" },
  { name: "DATE_TRUNC", signature: "DATE_TRUNC('field', source)" },
  { name: "EXTRACT", signature: "EXTRACT(field FROM source)" },
  { name: "AGE", signature: "AGE(timestamp1, timestamp2)" },
  { name: "ADD_MONTHS", signature: "ADD_MONTHS(date, n)" },
  { name: "TO_DATE", signature: "TO_DATE(string, format)" },
  { name: "TO_TIMESTAMP", signature: "TO_TIMESTAMP(string, format)" },
  { name: "TO_CHAR", signature: "TO_CHAR(value, format)" },
  { name: "TO_NUMBER", signature: "TO_NUMBER(string, format)" },
  { name: "MAKE_DATE", signature: "MAKE_DATE(year, month, day)" },
  { name: "CLOCK_TIMESTAMP", signature: "CLOCK_TIMESTAMP()" },
  { name: "TO_JSON", signature: "TO_JSON(value)" },
  { name: "TO_JSONB", signature: "TO_JSONB(value)" },
  { name: "JSON_BUILD_OBJECT", signature: "JSON_BUILD_OBJECT(key, value, ...)" },
  { name: "JSONB_BUILD_OBJECT", signature: "JSONB_BUILD_OBJECT(key, value, ...)" },
  { name: "JSON_BUILD_ARRAY", signature: "JSON_BUILD_ARRAY(...)" },
  { name: "JSONB_BUILD_ARRAY", signature: "JSONB_BUILD_ARRAY(...)" },
  { name: "JSON_OBJECT_KEYS", signature: "JSON_OBJECT_KEYS(json)" },
  { name: "JSONB_OBJECT_KEYS", signature: "JSONB_OBJECT_KEYS(jsonb)" },
  { name: "JSON_ARRAY_ELEMENTS", signature: "JSON_ARRAY_ELEMENTS(json)" },
  { name: "JSONB_ARRAY_ELEMENTS", signature: "JSONB_ARRAY_ELEMENTS(jsonb)" },
  { name: "JSON_EACH", signature: "JSON_EACH(json)" },
  { name: "JSONB_EACH", signature: "JSONB_EACH(jsonb)" },
  { name: "ROW_TO_JSON", signature: "ROW_TO_JSON(record)" },
  { name: "JSONB_PRETTY", signature: "JSONB_PRETTY(jsonb)" },
  { name: "JSONB_STRIP_NULLS", signature: "JSONB_STRIP_NULLS(jsonb)" },
  { name: "UNNEST", signature: "UNNEST(array)" },
  { name: "ARRAY_LENGTH", signature: "ARRAY_LENGTH(array, dimension)" },
  { name: "ARRAY_TO_STRING", signature: "ARRAY_TO_STRING(array, delimiter)" },
  { name: "STRING_TO_ARRAY", signature: "STRING_TO_ARRAY(string, delimiter)" },
  { name: "ARRAY_APPEND", signature: "ARRAY_APPEND(array, element)" },
  { name: "ARRAY_PREPEND", signature: "ARRAY_PREPEND(element, array)" },
  { name: "CAST", signature: "CAST(value AS type)" },
  { name: "COALESCE", signature: "COALESCE(val1, val2, ...)" },
  { name: "NVL", signature: "NVL(value, default)" },
  { name: "NVL2", signature: "NVL2(value, if_not_null, if_null)" },
  { name: "DECODE", signature: "DECODE(expression, search, result, ..., default)" },
  { name: "NULLIF", signature: "NULLIF(val1, val2)" },
  { name: "GREATEST", signature: "GREATEST(val1, val2, ...)" },
  { name: "LEAST", signature: "LEAST(val1, val2, ...)" },
  { name: "PG_TYPEOF", signature: "PG_TYPEOF(value)" },
  { name: "PG_SIZE_PRETTY", signature: "PG_SIZE_PRETTY(size)" },
  { name: "VERSION", signature: "VERSION()" },
  { name: "GEN_RANDOM_UUID", signature: "GEN_RANDOM_UUID()" },
];
