import { splitSqlStatements } from "@/lib/sql-statements";

const AUTO_TITLE = /^Query \d+$/;
const VERBS: Record<string, string> = {
  SELECT: "Select",
  VALUES: "Select",
  TABLE: "Select",
  INSERT: "Insert",
  UPDATE: "Update",
  DELETE: "Delete",
  MERGE: "Merge",
  REPLACE: "Replace",
  UPSERT: "Upsert",
  CREATE: "Create",
  ALTER: "Alter",
  DROP: "Drop",
  TRUNCATE: "Truncate",
  RENAME: "Rename",
  COMMENT: "Comment",
  CALL: "Call",
  EXEC: "Exec",
  EXECUTE: "Exec",
  GRANT: "Grant",
  REVOKE: "Revoke",
  EXPLAIN: "Explain",
  ANALYZE: "Analyze",
  VACUUM: "Vacuum",
  REINDEX: "Reindex",
  SHOW: "Show",
  DESCRIBE: "Describe",
  DESC: "Describe",
  COPY: "Copy",
  REFRESH: "Refresh",
  DO: "Block",
  BEGIN: "Block",
  DECLARE: "Block",
  OPTIMIZE: "Optimize",
};
const SKIP_STATEMENTS = new Set(["SET", "USE", "START", "COMMIT", "ROLLBACK", "SAVEPOINT", "LOCK"]);
const TRANSACTION_BEGIN = new Set(["TRANSACTION", "WORK", "ISOLATION", ";"]);
const MAIN_AFTER_WITH = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "VALUES",
  "TABLE",
]);
const OBJECT_LEAD = new Set([
  "FROM",
  "INTO",
  "UPDATE",
  "JOIN",
  "TABLE",
  "VIEW",
  "INDEX",
  "FUNCTION",
  "PROCEDURE",
  "SCHEMA",
  "DATABASE",
  "SEQUENCE",
  "TRIGGER",
  "TYPE",
  "ROLE",
  "USER",
  "EXTENSION",
  "PACKAGE",
  "SYNONYM",
  "POLICY",
  "DOMAIN",
  "COLLECTION",
  "DICTIONARY",
  "CALL",
  "EXEC",
  "EXECUTE",
  "ON",
]);
const OBJECT_SKIP = new Set([
  "IF",
  "NOT",
  "EXISTS",
  "ONLY",
  "LATERAL",
  "TEMP",
  "TEMPORARY",
  "UNLOGGED",
  "MATERIALIZED",
  "OR",
  "REPLACE",
  "UNIQUE",
  "CONCURRENTLY",
  "RECURSIVE",
  "GLOBAL",
  "LOCAL",
]);
const EXPLAIN_OPTIONS = /^(ANALYZE|VERBOSE|COSTS|BUFFERS|FORMAT|JSON|TEXT|PLAN|FOR)$/;
const ON_TARGET_KINDS = new Set(["INDEX", "TRIGGER", "POLICY"]);
const NOT_AN_OBJECT = new Set(["SELECT", "VALUES", "WITH", "DUAL", "CONFLICT"]);
const IDENT =
  /^(?:[A-Za-z_\u00C0-\uFFFF][\w$\u00C0-\uFFFF]*(?:\.[A-Za-z_\u00C0-\uFFFF][\w$\u00C0-\uFFFF]*)*|"[^"]*"|`[^`]*`|\[[^\]]*\])$/;

type Token = { text: string; upper: string; depth: number };

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
        continue;
      }
    }
    if (ch === "(") {
      depth += 1;
      tokens.push({ text: ch, upper: ch, depth });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ text: ch, upper: ch, depth });
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      const end = sql.indexOf(close, i + 1);
      const j = end === -1 ? n : end + 1;
      tokens.push({ text: sql.slice(i, j), upper: sql.slice(i, j).toUpperCase(), depth });
      i = j;
      continue;
    }
    const word = /^[\w$\u00C0-\uFFFF.]+/.exec(sql.slice(i));
    if (word) {
      tokens.push({ text: word[0], upper: word[0].toUpperCase(), depth });
      i += word[0].length;
      continue;
    }
    tokens.push({ text: ch, upper: ch, depth });
    i += 1;
  }
  return tokens;
}

function unquote(raw: string): string {
  const last = raw.split(".").pop() ?? "";
  return last.replace(/^["`[]|["`\]]$/g, "");
}

function objectAfter(tokens: Token[], from: number, depth: number): string | null {
  for (let i = from; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.depth !== depth || !OBJECT_LEAD.has(t.upper)) continue;
    let j = i + 1;
    while (j < tokens.length && OBJECT_SKIP.has(tokens[j].upper)) j += 1;
    const candidate = tokens[j];
    if (!candidate || candidate.depth !== depth) continue;
    if (NOT_AN_OBJECT.has(candidate.upper) || !IDENT.test(candidate.text)) continue;
    let last = candidate;
    while (tokens[j + 1]?.text === "." && tokens[j + 2] && IDENT.test(tokens[j + 2].text)) {
      last = tokens[j + 2];
      j += 2;
    }
    const name = unquote(last.text);
    if (name) return name;
  }
  return null;
}

function titleForStatement(text: string): string | null {
  const tokens = tokenize(text);
  let start = 0;
  while (start < tokens.length && tokens[start].text === "(") start += 1;
  const head = tokens[start];
  if (!head) return null;
  const depth = head.depth;
  let keyword = head.upper;
  if (SKIP_STATEMENTS.has(keyword)) return null;
  if (keyword === "BEGIN") {
    const next = tokens[start + 1];
    if (!next || TRANSACTION_BEGIN.has(next.upper)) return null;
  }
  let bodyStart = start;
  if (keyword === "WITH") {
    const main = tokens.findIndex(
      (t, i) => i > start && t.depth === depth && MAIN_AFTER_WITH.has(t.upper),
    );
    if (main === -1) return "Select";
    keyword = tokens[main].upper;
    bodyStart = main;
  }
  if (keyword === "EXPLAIN" || keyword === "ANALYZE") {
    let j = bodyStart + 1;
    while (
      j < tokens.length &&
      (tokens[j].text === "(" || tokens[j].depth > depth || EXPLAIN_OPTIONS.test(tokens[j].upper))
    )
      j += 1;
    const inner = tokens[j];
    if (inner && VERBS[inner.upper] && inner.upper !== "ANALYZE") {
      const name = objectAfter(tokens, j + 1, inner.depth);
      return name ? `Explain ${name}` : "Explain";
    }
    return VERBS[keyword];
  }
  const verb = VERBS[keyword];
  if (!verb) return null;
  if (verb === "Block") return "Block";
  let name: string | null = null;
  if (keyword === "CREATE") {
    const kindIndex = tokens.findIndex(
      (t, i) => i > bodyStart && t.depth === depth && OBJECT_LEAD.has(t.upper),
    );
    if (kindIndex !== -1 && ON_TARGET_KINDS.has(tokens[kindIndex].upper)) {
      const onIndex = tokens.findIndex(
        (t, i) => i > kindIndex && t.depth === depth && t.upper === "ON",
      );
      if (onIndex !== -1) name = objectAfter(tokens, onIndex, depth);
    }
  }
  if (!name) name = objectAfter(tokens, bodyStart, depth);
  return name ? `${verb} ${name}` : verb;
}

export function queryTitleFromSql(sql: string): string | null {
  for (const statement of splitSqlStatements(sql).statements) {
    const title = titleForStatement(statement.text);
    if (title) return title;
  }
  return null;
}

export function queryTabLabel(tab: { title: string; sql: string; filePath?: string }): string {
  if (tab.filePath || !AUTO_TITLE.test(tab.title)) return tab.title;
  return queryTitleFromSql(tab.sql) ?? tab.title;
}
