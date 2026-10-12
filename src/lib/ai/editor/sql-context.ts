import { type SqlStatement, splitSqlStatements } from "@/lib/sql-statements";

export interface StatementContext {
  statement: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function safeCut(text: string, index: number): number {
  const position = Math.max(0, Math.min(index, text.length));
  return position > 0 && position < text.length && isLowSurrogate(text.charCodeAt(position))
    ? position - 1
    : position;
}

function statementsOf(sql: string, dialect?: string): SqlStatement[] {
  const { statements, unterminated } = splitSqlStatements(sql, dialect);
  if (!unterminated) return statements;
  const from = statements.at(-1)?.end ?? 0;
  const rest = sql.slice(from);
  const lead = rest.length - rest.trimStart().length;
  const text = rest.trim();
  if (!text) return statements;
  return [...statements, { text, start: from + lead, end: from + lead + text.length }];
}

function keepHead(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 1) return "";
  let cut = safeCut(text, limit - 1);
  const newline = text.lastIndexOf("\n", cut);
  if (newline > limit / 2) cut = newline;
  return `${text.slice(0, cut)}…`;
}

function keepTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 1) return "";
  let cut = safeCut(text, text.length - limit + 1);
  const newline = text.indexOf("\n", cut);
  if (newline >= 0 && newline < text.length - limit / 2) cut = newline + 1;
  return `…${text.slice(cut)}`;
}

export function statementContext(
  sql: string,
  offset: number,
  options: { dialect?: string; maxChars?: number } = {},
): StatementContext {
  const maxChars = Math.max(0, options.maxChars ?? 4000);
  const statements = statementsOf(sql, options.dialect);
  const position = Math.max(0, Math.min(offset, sql.length));
  if (statements.length === 0) {
    return { statement: "", start: position, end: position, before: "", after: "" };
  }
  let current = 0;
  for (let index = 0; index < statements.length; index++) {
    if (statements[index].start <= position) current = index;
    else break;
  }
  const target = statements[current];
  const beforeText = statements
    .slice(0, current)
    .map((statement) => statement.text)
    .join("\n");
  const afterText = statements
    .slice(current + 1)
    .map((statement) => statement.text)
    .join("\n");
  const budget = Math.max(0, maxChars - target.text.length);
  const half = Math.floor(budget / 2);
  let beforeBudget = half;
  let afterBudget = budget - half;
  if (beforeText.length < beforeBudget) afterBudget += beforeBudget - beforeText.length;
  else if (afterText.length < afterBudget) beforeBudget += afterBudget - afterText.length;
  return {
    statement: target.text,
    start: target.start,
    end: target.end,
    before: keepTail(beforeText, beforeBudget),
    after: keepHead(afterText, afterBudget),
  };
}

export function completionWindow(
  sql: string,
  offset: number,
  options: { before?: number; after?: number } = {},
): { prefix: string; suffix: string } {
  const before = Math.max(0, options.before ?? 6000);
  const after = Math.max(0, options.after ?? 1500);
  const position = safeCut(sql, offset);
  let start = position - before;
  if (start <= 0) start = 0;
  else {
    const newline = sql.indexOf("\n", start);
    start =
      newline >= 0 && newline < position
        ? newline + 1
        : start + (isLowSurrogate(sql.charCodeAt(start)) ? 1 : 0);
  }
  let end = position + after;
  if (end >= sql.length) end = sql.length;
  else {
    const newline = sql.lastIndexOf("\n", end - 1);
    end = newline > position ? newline : safeCut(sql, end);
  }
  return { prefix: sql.slice(start, position), suffix: sql.slice(position, end) };
}
