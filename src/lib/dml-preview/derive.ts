import { editorBindParams } from "@/lib/bind-params";
import type { DatabaseKind } from "@/lib/db/providers";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { applySelectRowLimit } from "@/lib/select-row-limit";
import { sqlTokens, writesData } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

export type DmlKind = "update" | "delete" | "insert_select" | "merge";

export interface DmlAssignment {
  column: string;
  expression: string;
  previewed: boolean;
}

export interface DmlPreviewPlan {
  status: "ready";
  kind: DmlKind;
  statement: string;
  table: string;
  whereMissing: boolean;
  note: string | null;
  assignments: DmlAssignment[];
  countSql: string;
  sampleSql: string;
  limit: number;
}

export interface DmlPreviewUnavailable {
  status: "unavailable";
  kind: DmlKind | null;
  statement: string;
  reason: string;
  whereMissing: boolean;
}

export type DmlPreviewDerivation = DmlPreviewPlan | DmlPreviewUnavailable;

type Token = ReturnType<typeof sqlTokens>[number];

interface Clause {
  word: string;
  start: number;
  body: number;
}

export const DML_PREVIEW_ALIAS = "l8db_preview";
export const DML_PREVIEW_COUNT_COLUMN = "affected_rows";

const DML_WORDS = new Set(["UPDATE", "DELETE", "INSERT", "MERGE"]);
const UPDATE_CLAUSES = ["FROM", "WHERE", "RETURNING", "OUTPUT", "ORDER", "LIMIT", "OPTION"];
const DELETE_CLAUSES = [
  "FROM",
  "USING",
  "WHERE",
  "RETURNING",
  "OUTPUT",
  "ORDER",
  "LIMIT",
  "OPTION",
];
const NOT_FUNCTIONS = new Set([
  "IN",
  "EXISTS",
  "ANY",
  "ALL",
  "SOME",
  "NOT",
  "AND",
  "OR",
  "ON",
  "USING",
  "VALUES",
  "AS",
  "FROM",
  "JOIN",
  "WHERE",
  "SELECT",
  "TOP",
  "OVER",
  "FILTER",
  "WITHIN",
  "INTERVAL",
  "ROW",
  "ARRAY",
  "LATERAL",
  "IS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "THEN",
  "ELSE",
  "WHEN",
  "CASE",
  "SET",
  "INTO",
  "END",
  "BY",
  "WITH",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "DISTINCT",
  "LIMIT",
  "OFFSET",
  "APPLY",
  "TABLE",
  "PARTITION",
  "KEY",
]);
const SAFE_FUNCTIONS = new Set(
  [
    "lower",
    "upper",
    "length",
    "len",
    "char_length",
    "character_length",
    "octet_length",
    "trim",
    "ltrim",
    "rtrim",
    "btrim",
    "substring",
    "substr",
    "left",
    "right",
    "replace",
    "concat",
    "concat_ws",
    "lpad",
    "rpad",
    "position",
    "strpos",
    "instr",
    "locate",
    "charindex",
    "abs",
    "round",
    "floor",
    "ceil",
    "ceiling",
    "trunc",
    "mod",
    "power",
    "sqrt",
    "sign",
    "coalesce",
    "nullif",
    "ifnull",
    "isnull",
    "nvl",
    "nvl2",
    "iif",
    "decode",
    "greatest",
    "least",
    "cast",
    "convert",
    "try_cast",
    "try_convert",
    "extract",
    "date_part",
    "date_trunc",
    "date",
    "datetime",
    "time",
    "julianday",
    "strftime",
    "now",
    "current_date",
    "current_time",
    "current_timestamp",
    "localtimestamp",
    "localtime",
    "getdate",
    "getutcdate",
    "sysdate",
    "systimestamp",
    "sysdatetime",
    "datediff",
    "dateadd",
    "datepart",
    "datename",
    "timestampdiff",
    "timestampadd",
    "date_add",
    "date_sub",
    "to_date",
    "to_char",
    "to_number",
    "to_timestamp",
    "make_date",
    "age",
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "array_length",
    "cardinality",
    "json_extract",
    "json_value",
    "jsonb_extract_path",
    "jsonb_extract_path_text",
    "json_extract_path_text",
    "regexp_like",
    "regexp_replace",
    "regexp_substr",
    "format",
    "md5",
  ].map((name) => name.toUpperCase()),
);
const TYPE_NAMES = new Set([
  "CHAR",
  "VARCHAR",
  "VARCHAR2",
  "NCHAR",
  "NVARCHAR",
  "NVARCHAR2",
  "NUMBER",
  "NUMERIC",
  "DECIMAL",
  "DEC",
  "FLOAT",
  "TIMESTAMP",
  "TIME",
  "DATETIME2",
  "DATETIMEOFFSET",
  "BINARY",
  "VARBINARY",
  "BIT",
  "INTERVAL",
  "RAW",
]);
const SIDE_EFFECT_WORDS = new Set(["NEXTVAL", "CURRVAL", "SETVAL"]);
const IDENTIFIER =
  /^(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_\u0080-￿][\w$#\u0080-￿]*)/;
const REF_STOP_WORDS = new Set([
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
  "STRAIGHT_JOIN",
  "ON",
  "USING",
  "WITH",
  "SET",
  "WHERE",
  "PARTITION",
  "TABLESAMPLE",
  "OUTER",
]);

function stripComments(text: string, dialect: string): string {
  const comments: [number, number][] = [];
  sqlTokens(text, dialect, comments);
  if (!comments.length) return text;
  let result = "";
  let cursor = 0;
  for (const [start, end] of comments) {
    result += `${text.slice(cursor, start)} `;
    cursor = end;
  }
  return result + text.slice(cursor);
}

function normalize(text: string, dialect: string): string {
  return stripComments(text, dialect).trim().replace(/;\s*$/, "").trim();
}

function maskLiterals(text: string, dialect: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let i = 0;
  while (i < text.length) {
    const quote = text.indexOf("'", i);
    const dollar = text.indexOf("$", i);
    const next = quote < 0 ? dollar : dollar < 0 ? quote : Math.min(quote, dollar);
    if (next < 0) break;
    if (text[next] === "$") {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(text.slice(next, next + 64))?.[0];
      if (!tag) {
        i = next + 1;
        continue;
      }
      const end = text.indexOf(tag, next + tag.length);
      const stop = end < 0 ? text.length : end + tag.length;
      parts.push(text.slice(cursor, next), "''", " ".repeat(Math.max(0, stop - next - 2)));
      cursor = i = stop;
      continue;
    }
    const backslash = dialect === "mysql";
    let j = next + 1;
    while (j < text.length) {
      const c = text[j];
      if (c === "'" && text[j + 1] === "'") j += 2;
      else if (c === "\\" && backslash) j += 2;
      else if (c === "'") {
        j++;
        break;
      } else j++;
    }
    parts.push(text.slice(cursor, next), "'", " ".repeat(Math.max(0, j - next - 2)), "'");
    cursor = i = j;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function scanTopLevel(text: string, visit: (index: number) => boolean): void {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      i++;
      while (i < text.length) {
        if (text[i] === close) {
          if (text[i + 1] === close) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && visit(i)) return;
    i++;
  }
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  scanTopLevel(text, (index) => {
    if (text[index] === separator) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
    return false;
  });
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function assignmentSplit(text: string): [string, string] | null {
  let found = -1;
  scanTopLevel(text, (index) => {
    if (text[index] !== "=") return false;
    const before = text[index - 1];
    if (before === "<" || before === ">" || before === "!" || before === ":") return false;
    found = index;
    return true;
  });
  if (found < 0) return null;
  return [text.slice(0, found).trim(), text.slice(found + 1).trim()];
}

function unquote(identifier: string): string {
  const first = identifier[0];
  if (first === '"') return identifier.slice(1, -1).replace(/""/g, '"');
  if (first === "`") return identifier.slice(1, -1).replace(/``/g, "`");
  if (first === "[") return identifier.slice(1, -1).replace(/\]\]/g, "]");
  return identifier;
}

interface ParsedRef {
  name: string;
  segments: string[];
  alias: string | null;
  rest: string;
}

function parseRef(text: string): ParsedRef | null {
  let source = text.trim().replace(/^ONLY\s+/i, "");
  const segments: string[] = [];
  let name = "";
  for (;;) {
    const match = IDENTIFIER.exec(source);
    if (!match) return null;
    segments.push(match[0]);
    name += match[0];
    source = source.slice(match[0].length);
    const dot = /^\s*\.\s*/.exec(source);
    if (!dot) break;
    if (/^\s*\.\s*\*/.test(source)) {
      source = source.replace(/^\s*\.\s*\*/, "");
      break;
    }
    name += ".";
    source = source.slice(dot[0].length);
  }
  source = source.trimStart();
  let alias: string | null = null;
  const asMatch = /^AS\s+/i.exec(source);
  const candidate = IDENTIFIER.exec(asMatch ? source.slice(asMatch[0].length) : source);
  if (candidate && (asMatch || !REF_STOP_WORDS.has(candidate[0].toUpperCase()))) {
    alias = candidate[0];
    source = (asMatch ? source.slice(asMatch[0].length) : source)
      .slice(candidate[0].length)
      .trimStart();
  }
  return { name, segments, alias, rest: source };
}

function qualifierOf(ref: ParsedRef): string {
  return ref.alias ?? ref.segments[ref.segments.length - 1];
}

function stripLockHints(text: string, dialect: string): string {
  if (dialect !== "mssql") return text;
  return text
    .replace(/\bWITH\s*\([^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function functionIssue(text: string, dialect: string): string | null {
  const masked = maskLiterals(text, dialect);
  const words = sqlTokens(masked, dialect);
  for (const [index, token] of words.entries()) {
    if (SIDE_EFFECT_WORDS.has(token.word))
      return `Sequenzzugriff (${token.word}) verändert Zähler und wird nicht ausgeführt.`;
    if (token.word === "NEXT" && words[index + 1]?.word === "VALUE")
      return "Sequenzzugriff (NEXT VALUE FOR) verändert Zähler und wird nicht ausgeführt.";
  }
  const pattern =
    /("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$#]*)(?:\s*\.\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$#]*))*\s*\(/g;
  for (const match of masked.matchAll(pattern)) {
    const full = match[0].replace(/\s*\($/, "");
    const parts = full.split(/\s*\.\s*/);
    const name = unquote(parts[parts.length - 1]).toUpperCase();
    if (parts.length === 1 && NOT_FUNCTIONS.has(name)) continue;
    if (parts.length === 1 && SAFE_FUNCTIONS.has(name)) continue;
    if (parts.length === 1 && TYPE_NAMES.has(name)) continue;
    return `Funktion „${full}“ wird für die Vorschau nicht ausgeführt, weil Seiteneffekte nicht ausgeschlossen sind.`;
  }
  return null;
}

function firstIssue(parts: string[], dialect: string): string | null {
  for (const part of parts) {
    const issue = part ? functionIssue(part, dialect) : null;
    if (issue) return issue;
  }
  return null;
}

function simpleExpression(text: string, dialect: string): boolean {
  if (!text || /^DEFAULT$/i.test(text.trim())) return false;
  const words = sqlTokens(maskLiterals(text, dialect), dialect);
  if (words.some((token) => token.word === "SELECT")) return false;
  return functionIssue(text, dialect) === null;
}

function findClauses(tokens: Token[], from: number, words: string[]): Clause[] {
  const result: Clause[] = [];
  const top = tokens.filter((token) => token.depth === 0 && token.start >= from);
  for (const [index, token] of top.entries()) {
    if (!words.includes(token.word)) continue;
    if (token.word === "ORDER" && top[index + 1]?.word !== "BY") continue;
    if (token.word === "FROM" && top[index - 1]?.word === "DISTINCT") continue;
    if (token.word === "USING" && result.some((clause) => clause.word === "USING")) continue;
    const body =
      token.word === "ORDER" ? top[index + 1].start + 2 : token.start + token.word.length;
    result.push({ word: token.word, start: token.start, body });
  }
  return result;
}

function clauseText(text: string, clauses: Clause[], word: string, end = text.length): string {
  const index = clauses.findIndex((clause) => clause.word === word);
  if (index < 0) return "";
  const next = clauses[index + 1]?.start ?? end;
  return text.slice(clauses[index].body, next).trim();
}

function aliasName(name: string, suffix: string, dialect: string): string {
  const base = dialect === "oracle" ? name.slice(0, 22) : name;
  return quoteIdentifier(`${base} (${suffix})`, identifierStyleForKind(dialect as DatabaseKind));
}

interface Bound {
  top: string | null;
  order: string;
  limit: string;
}

function buildQueries(
  dialect: string,
  projection: string,
  source: string,
  where: string,
  bound: Bound,
  limit: number,
): { countSql: string; sampleSql: string } {
  const whereSql = where ? ` WHERE ${where}` : "";
  const bounded = Boolean(bound.top || bound.limit);
  if (!bounded) {
    return {
      countSql: `SELECT COUNT(*) AS ${DML_PREVIEW_COUNT_COLUMN} FROM ${source}${whereSql}`,
      sampleSql: applySelectRowLimit(
        `SELECT ${projection} FROM ${source}${whereSql}`,
        dialect,
        limit,
      ),
    };
  }
  const top = bound.top ? `TOP ${bound.top} ` : "";
  const tail = `${bound.order ? ` ORDER BY ${bound.order}` : ""}${bound.limit ? ` LIMIT ${bound.limit}` : ""}`;
  return {
    countSql: `SELECT COUNT(*) AS ${DML_PREVIEW_COUNT_COLUMN} FROM (SELECT ${top}1 AS l8db_row FROM ${source}${whereSql}${tail}) ${DML_PREVIEW_ALIAS}`,
    sampleSql: applySelectRowLimit(
      `SELECT * FROM (SELECT ${top}${projection} FROM ${source}${whereSql}${tail}) ${DML_PREVIEW_ALIAS}`,
      dialect,
      limit,
    ),
  };
}

function unavailable(
  statement: string,
  kind: DmlKind | null,
  reason: string,
  whereMissing = false,
): DmlPreviewUnavailable {
  return { status: "unavailable", kind, statement, reason, whereMissing };
}

function readTop(text: string, from: number): { top: string | null; next: number } {
  const match = /^\s*TOP\s*(\([^)]*\)(?:\s*PERCENT\b)?|\d+(?:\s*PERCENT\b)?)/i.exec(
    text.slice(from),
  );
  if (!match) return { top: null, next: from };
  return { top: match[1].replace(/\s+/g, " "), next: from + match[0].length };
}

function deriveUpdate(
  text: string,
  tokens: Token[],
  dialect: string,
  limit: number,
): DmlPreviewDerivation {
  const top = tokens.filter((token) => token.depth === 0);
  let cursor = top[0].start + top[0].word.length;
  let index = 1;
  while (["LOW_PRIORITY", "IGNORE"].includes(top[index]?.word)) {
    cursor = top[index].start + top[index].word.length;
    index++;
  }
  if (top[index]?.word === "OR" && top[index + 1]) {
    cursor = top[index + 1].start + top[index + 1].word.length;
  }
  const topClause = readTop(text, cursor);
  cursor = topClause.next;
  const set = top.find((token) => token.word === "SET" && token.start >= cursor);
  if (!set) return unavailable(text, "update", "Keine SET-Klausel erkannt.");
  const refs = stripLockHints(text.slice(cursor, set.start).trim(), dialect);
  const target = parseRef(refs);
  if (!target) return unavailable(text, "update", "Keine Zieltabelle erkannt.");
  const clauses = findClauses(tokens, set.start + 3, UPDATE_CLAUSES);
  const assignmentsText = text.slice(set.start + 3, clauses[0]?.start ?? text.length).trim();
  const where = clauseText(text, clauses, "WHERE");
  const from = stripLockHints(clauseText(text, clauses, "FROM"), dialect);
  const whereMissing = !where;
  if (/^CURRENT\s+OF\b/i.test(where))
    return unavailable(text, "update", "WHERE CURRENT OF bezieht sich auf einen Cursor.", false);
  const qualifier = qualifierOf(target);
  const joined = Boolean(target.rest) || Boolean(from);
  let source = refs;
  if (from) {
    const mentioned =
      dialect === "mssql" &&
      new RegExp(
        `(^|[^\\w$#])${unquote(qualifier).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w$#]|$)`,
        "i",
      ).test(from.replace(/[[\]"`]/g, ""));
    source = mentioned ? from : `${refs}, ${from}`;
  }
  const assignments: DmlAssignment[] = [];
  const projections: string[] = [];
  for (const part of splitTopLevel(assignmentsText, ",")) {
    const split = assignmentSplit(part);
    if (!split)
      return unavailable(text, "update", "SET-Klausel konnte nicht gelesen werden.", whereMissing);
    const [lhs, rhs] = split;
    const column = parseRef(lhs);
    if (!column || lhs.startsWith("(") || column.rest) {
      assignments.push({ column: lhs, expression: rhs, previewed: false });
      continue;
    }
    const name = unquote(column.segments[column.segments.length - 1]);
    const reference = column.segments.length > 1 ? column.name : `${qualifier}.${column.name}`;
    const previewed = simpleExpression(rhs, dialect);
    projections.push(`${reference} AS ${aliasName(name, "alt", dialect)}`);
    if (previewed) projections.push(`(${rhs}) AS ${aliasName(name, "neu", dialect)}`);
    assignments.push({ column: name, expression: rhs, previewed });
  }
  if (!assignments.length)
    return unavailable(text, "update", "SET-Klausel konnte nicht gelesen werden.", whereMissing);
  const issue = firstIssue([refs, from, where], dialect);
  if (issue) return unavailable(text, "update", issue, whereMissing);
  projections.push(`${qualifier}.*`);
  const bound: Bound = {
    top: topClause.top,
    order: clauseText(text, clauses, "ORDER"),
    limit: clauseText(text, clauses, "LIMIT"),
  };
  const queries = buildQueries(dialect, projections.join(", "), source, where, bound, limit);
  return finish(
    dialect,
    text,
    "update",
    target.name,
    whereMissing,
    joinedNote(joined),
    assignments,
    queries,
    limit,
  );
}

function joinedNote(joined: boolean): string | null {
  return joined
    ? "Die Anweisung verknüpft weitere Tabellen. Zeilen mit mehreren Treffern können mehrfach gezählt werden."
    : null;
}

function deriveDelete(
  text: string,
  tokens: Token[],
  dialect: string,
  limit: number,
): DmlPreviewDerivation {
  const top = tokens.filter((token) => token.depth === 0);
  let cursor = top[0].start + top[0].word.length;
  let index = 1;
  while (["LOW_PRIORITY", "QUICK", "IGNORE"].includes(top[index]?.word)) {
    cursor = top[index].start + top[index].word.length;
    index++;
  }
  const topClause = readTop(text, cursor);
  cursor = topClause.next;
  const clauses = findClauses(tokens, cursor, DELETE_CLAUSES);
  const first = clauses[0];
  let targets: string;
  let source: string;
  let rest: Clause[];
  if (first && first.word === "FROM" && !text.slice(cursor, first.start).trim()) {
    const next = clauses[1];
    const firstRefs = text.slice(first.body, next?.start ?? text.length).trim();
    targets = firstRefs;
    rest = clauses.slice(1);
    if (next?.word === "USING") {
      const using = text.slice(next.body, clauses[2]?.start ?? text.length).trim();
      source = dialect === "mysql" ? using : `${firstRefs}, ${using}`;
      rest = clauses.slice(2);
    } else if (next?.word === "FROM") {
      const second = text.slice(next.body, clauses[2]?.start ?? text.length).trim();
      source = second;
      rest = clauses.slice(2);
    } else source = firstRefs;
  } else {
    targets = text.slice(cursor, first?.start ?? text.length).trim();
    rest = clauses;
    if (first?.word === "FROM") {
      source = text.slice(first.body, clauses[1]?.start ?? text.length).trim();
      rest = clauses.slice(1);
    } else source = targets;
  }
  targets = stripLockHints(targets, dialect);
  source = stripLockHints(source, dialect);
  const target = parseRef(splitTopLevel(targets, ",")[0] ?? "");
  if (!target || !source) return unavailable(text, "delete", "Keine Zieltabelle erkannt.");
  const where = clauseText(text, rest, "WHERE");
  const whereMissing = !where;
  if (/^CURRENT\s+OF\b/i.test(where))
    return unavailable(text, "delete", "WHERE CURRENT OF bezieht sich auf einen Cursor.");
  const issue = firstIssue([source, where], dialect);
  if (issue) return unavailable(text, "delete", issue, whereMissing);
  const single = source === targets && !target.rest && splitTopLevel(targets, ",").length === 1;
  const projection = single ? "*" : `${qualifierOf(target)}.*`;
  const bound: Bound = {
    top: topClause.top,
    order: clauseText(text, rest, "ORDER"),
    limit: clauseText(text, rest, "LIMIT"),
  };
  const queries = buildQueries(dialect, projection, source, where, bound, limit);
  return finish(
    dialect,
    text,
    "delete",
    target.name,
    whereMissing,
    joinedNote(!single),
    [],
    queries,
    limit,
  );
}

function deriveMerge(
  text: string,
  tokens: Token[],
  dialect: string,
  limit: number,
): DmlPreviewDerivation {
  const top = tokens.filter((token) => token.depth === 0);
  const using = top.find((token) => token.word === "USING");
  const on = top.find((token) => token.word === "ON" && using && token.start > using.start);
  const when = top.find((token) => token.word === "WHEN" && on && token.start > on.start);
  if (!using || !on || !when)
    return unavailable(text, "merge", "MERGE ohne erkennbares USING … ON … WHEN.");
  const into = top[1]?.word === "INTO" ? top[1] : null;
  const targetStart = into ? into.start + 4 : top[0].start + 5;
  const targetText = stripLockHints(text.slice(targetStart, using.start).trim(), dialect);
  const target = parseRef(targetText);
  if (!target) return unavailable(text, "merge", "Keine Zieltabelle erkannt.");
  const sourceText = text.slice(using.start + 5, on.start).trim();
  const condition = text.slice(on.start + 2, when.start).trim();
  const issue = firstIssue([targetText, sourceText, condition], dialect);
  if (issue) return unavailable(text, "merge", issue);
  const source = `${targetText} INNER JOIN ${sourceText} ON ${condition}`;
  const queries = buildQueries(
    dialect,
    `${qualifierOf(target)}.*`,
    source,
    "",
    { top: null, order: "", limit: "" },
    limit,
  );
  return finish(
    dialect,
    text,
    "merge",
    target.name,
    false,
    "Gezählt werden bestehende Zielzeilen mit Treffer (WHEN MATCHED). Einfügungen aus WHEN NOT MATCHED sind nicht enthalten.",
    [],
    queries,
    limit,
  );
}

function deriveInsertSelect(
  text: string,
  tokens: Token[],
  dialect: string,
  limit: number,
): DmlPreviewDerivation {
  const top = tokens.filter((token) => token.depth === 0);
  if (top[1]?.word === "ALL" || top[1]?.word === "FIRST")
    return unavailable(text, "insert_select", "Mehrtabellen-INSERT wird nicht abgeleitet.");
  const select = top.find((token) => token.word === "SELECT" || token.word === "WITH");
  if (!select) return unavailable(text, "insert_select", "Keine SELECT-Quelle erkannt.");
  const head = text.slice(top[0].start + top[0].word.length, select.start);
  const target = parseRef(head.replace(/^\s*(?:IGNORE\s+)?(?:INTO\s+)?/i, ""));
  if (!target) return unavailable(text, "insert_select", "Keine Zieltabelle erkannt.");
  const tail = top.find(
    (token, index) =>
      token.start > select.start &&
      (token.word === "RETURNING" ||
        (token.word === "ON" && ["CONFLICT", "DUPLICATE"].includes(top[index + 1]?.word))),
  );
  const selectText = text.slice(select.start, tail?.start ?? text.length).trim();
  const issue = functionIssue(selectText, dialect);
  if (issue) return unavailable(text, "insert_select", issue);
  const queries = {
    countSql: `SELECT COUNT(*) AS ${DML_PREVIEW_COUNT_COLUMN} FROM (${selectText}) ${DML_PREVIEW_ALIAS}`,
    sampleSql: applySelectRowLimit(
      `SELECT * FROM (${selectText}) ${DML_PREVIEW_ALIAS}`,
      dialect,
      limit,
    ),
  };
  return finish(
    dialect,
    text,
    "insert_select",
    target.name,
    false,
    "Angezeigt werden die Zeilen, die eingefügt würden.",
    [],
    queries,
    limit,
  );
}

function finish(
  dialect: string,
  statement: string,
  kind: DmlKind,
  table: string,
  whereMissing: boolean,
  note: string | null,
  assignments: DmlAssignment[],
  queries: { countSql: string; sampleSql: string },
  limit: number,
): DmlPreviewDerivation {
  if (writesData(queries.countSql, dialect) || writesData(queries.sampleSql, dialect))
    return unavailable(
      statement,
      kind,
      "Die abgeleitete Abfrage wäre nicht rein lesend.",
      whereMissing,
    );
  return {
    status: "ready",
    kind,
    statement,
    table,
    whereMissing,
    note,
    assignments,
    countSql: queries.countSql,
    sampleSql: queries.sampleSql,
    limit,
  };
}

function kindOfTokens(tokens: Token[]): DmlKind | "cte" | null {
  const top = tokens.filter((token) => token.depth === 0);
  const first = top[0]?.word;
  if (first === "UPDATE") return "update";
  if (first === "DELETE") return "delete";
  if (first === "MERGE") return "merge";
  if (first === "INSERT") {
    const values = top.findIndex((token) => token.word === "VALUES" || token.word === "DEFAULT");
    const select = top.findIndex((token) => token.word === "SELECT" || token.word === "WITH");
    if (select < 0) return null;
    if (values >= 0 && values < select) return null;
    return "insert_select";
  }
  if (first === "WITH" && tokens.some((token) => DML_WORDS.has(token.word))) return "cte";
  return null;
}

function hasTopLevelWhere(tokens: Token[]): boolean {
  return tokens.some((token) => token.depth === 0 && token.word === "WHERE");
}

export function dmlKindOf(statement: string, dialect: string): DmlKind | "cte" | null {
  return kindOfTokens(sqlTokens(normalize(statement, dialect), dialect));
}

export function hasBindParameters(sql: string): boolean {
  return editorBindParams(sql).length > 0;
}

export function needsDmlPreview(sql: string, dialect: string): boolean {
  if (!sql.trim()) return false;
  return splitSqlStatements(sql, dialect).statements.some(
    (statement) => kindOfTokens(sqlTokens(statement.text, dialect)) !== null,
  );
}

export function deriveDmlPreview(
  sql: string,
  dialect: string,
  limit = 100,
): DmlPreviewDerivation | null {
  const statements = splitSqlStatements(sql, dialect).statements.flatMap((statement) => {
    const text = normalize(statement.text, dialect);
    if (!text) return [];
    const tokens = sqlTokens(text, dialect);
    return [{ text, tokens, kind: kindOfTokens(tokens) }];
  });
  const relevant = statements.filter((statement) => statement.kind !== null);
  if (!relevant.length) return null;
  const firstKind = relevant[0].kind;
  const kind = firstKind === "cte" ? null : firstKind;
  if (statements.length > 1)
    return unavailable(
      sql.trim(),
      kind,
      "Das Skript enthält mehrere Anweisungen. Die Vorschau ist nur für eine einzelne Anweisung möglich, weil jede Anweisung die Daten der nächsten verändert.",
      relevant.some(
        (statement) =>
          (statement.kind === "update" || statement.kind === "delete") &&
          !hasTopLevelWhere(statement.tokens),
      ),
    );
  const { text, tokens } = relevant[0];
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  if (firstKind === "cte")
    return unavailable(
      text,
      null,
      "Datenverändernde CTE (WITH … UPDATE/DELETE/INSERT) wird nicht abgeleitet.",
    );
  if (firstKind === "update") return deriveUpdate(text, tokens, dialect, safeLimit);
  if (firstKind === "delete") return deriveDelete(text, tokens, dialect, safeLimit);
  if (firstKind === "merge") return deriveMerge(text, tokens, dialect, safeLimit);
  return deriveInsertSelect(text, tokens, dialect, safeLimit);
}
