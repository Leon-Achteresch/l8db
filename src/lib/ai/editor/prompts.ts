import type { EditorAiAction } from "./metrics";

const DIALECTS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL/MariaDB",
  sqlite: "SQLite",
  sqlite_http: "SQLite",
  mssql: "Microsoft SQL Server (T-SQL)",
  clickhouse: "ClickHouse",
  oracle: "Oracle (SQL and PL/SQL)",
  cassandra: "Cassandra CQL",
  duckdb: "DuckDB",
  odbc: "ANSI SQL via ODBC",
  athena: "Amazon Athena (Trino)",
  bigquery: "Google BigQuery Standard SQL",
  snowflake: "Snowflake",
  mongodb: "MongoDB shell syntax",
  redis: "Redis commands",
  elasticsearch: "Elasticsearch SQL",
  influxdb: "InfluxQL",
  dynamodb: "DynamoDB PartiQL",
};

export function dialectName(kind: string | null | undefined): string {
  return (kind && DIALECTS[kind]) || "ANSI SQL";
}

export function dialectLine(kind: string | null | undefined, defaultSchema?: string | null) {
  return `Dialect: ${dialectName(kind)}.${defaultSchema ? ` Default schema: ${defaultSchema}.` : ""}`;
}

const INLINE = `You are the SQL autocomplete engine of the l8db database client.
Return ONLY the text that belongs exactly at <CURSOR>. No explanations, no code fences, no text that already exists before or after the cursor.
Continue the current statement in the user's style and casing. Use only tables and columns that exist in the given schema. At most 8 lines. Return nothing when no useful completion fits.`;

const EDIT = `You edit SQL inside the l8db database client.
Answer ONLY with SEARCH/REPLACE blocks for the TARGET text, nothing else:
<<<<<<< SEARCH
exact lines copied from TARGET
=======
replacement lines
>>>>>>> REPLACE
Use several small blocks instead of repeating unchanged lines. SEARCH must match TARGET exactly and uniquely. When TARGET is empty, answer with only the new SQL in a single \`\`\`sql block.
Use only tables and columns from the schema; when something is missing, look at the overview and never invent identifiers. Keep the user's comments. Format SQL and PL/SQL you write readably but compactly: one clause per line (SELECT, FROM, JOIN, WHERE, GROUP BY, ORDER BY), all clause keywords of a statement start in the same column, indent nested blocks (BEGIN/END, IF, LOOP, CASE, subqueries) by one level, no right-aligned keywords or column alignment, keep short column lists and conditions on one line and break only lines longer than about 100 characters, no blank lines inside a statement. Match the existing indentation and keyword casing, otherwise use 2 spaces and uppercase keywords; never reformat code you do not change. Never add DROP, TRUNCATE, or UPDATE/DELETE without WHERE unless the task explicitly asks for it. Write SQL comments in the language of the task.`;

const SUMMARY = `You compress chat history for a database assistant. Summarize the conversation in the user's language in at most 12 short bullet points: goals, decisions, final SQL that is still relevant (verbatim), table and column names, open questions. No preamble.`;

export const ACTION_TASKS: Partial<Record<EditorAiAction, string>> = {
  fix: "Fix the error in TARGET with the smallest possible change.",
  optimize:
    "Make TARGET faster without changing its result. Prefer sargable predicates, fewer scans and avoiding needless sorts. If an index would help, add it as an SQL comment (-- CREATE INDEX …) below the statement instead of executing DDL.",
  comment:
    "Add short, helpful SQL comments to TARGET that explain the intent of non-obvious parts. Do not change the SQL itself.",
  cte: "Restructure TARGET using common table expressions (WITH …) so that every step is readable. The result must stay identical.",
  testdata:
    "Write INSERT statements with 10 realistic, varied test rows for the tables used in TARGET. Respect data types, NOT NULL and foreign keys (insert parents first). Answer with only the new SQL.",
};

export function systemPrompt(family: "inline" | "edit" | "summary"): string {
  if (family === "inline") return INLINE;
  if (family === "summary") return SUMMARY;
  return EDIT;
}

export function joinSections(sections: (string | null | undefined | false | 0)[]): string {
  return sections
    .filter((section): section is string => typeof section === "string" && Boolean(section.trim()))
    .join("\n\n");
}

export function fnv1a(text: string): string {
  let low = 0x811c9dc5;
  let high = 0x050c5d1f;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x01000193) ^ (low >>> 7);
  }
  return (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
}
