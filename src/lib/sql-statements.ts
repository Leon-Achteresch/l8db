export interface SqlStatement {
  text: string;
  start: number;
  end: number;
}

export interface SqlSplitResult {
  statements: SqlStatement[];
  unterminated: boolean;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
const DOLLAR_TAG_ASCII = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

export function splitSqlStatements(sql: string, dialect?: string): SqlSplitResult {
  if (dialect === "redis") {
    let offset = 0;
    const statements: SqlStatement[] = [];
    for (const line of sql.split("\n")) {
      const text = line.trim();
      if (text && !text.startsWith("#")) {
        const start = offset + line.indexOf(text);
        statements.push({ text, start, end: start + text.length });
      }
      offset += line.length + 1;
    }
    return { statements, unterminated: false };
  }
  if (dialect === "mongodb") {
    const text = sql.trim();
    const start = sql.indexOf(text);
    return {
      statements: text ? [{ text, start, end: start + text.length }] : [],
      unterminated: false,
    };
  }
  const statements: SqlStatement[] = [];
  const length = sql.length;
  let index = 0;
  let segmentStart = -1;
  let hasCode = false;
  let unterminated = false;
  let plsql = false;
  const leadingWords: string[] = [];

  const flush = (endExclusive: number) => {
    if (segmentStart < 0 || !hasCode) {
      segmentStart = -1;
      hasCode = false;
      return;
    }
    let end = endExclusive;
    while (end > segmentStart && isSpace(sql[end - 1])) end -= 1;
    if (end > segmentStart) {
      statements.push({ text: sql.slice(segmentStart, end), start: segmentStart, end });
    }
    segmentStart = -1;
    hasCode = false;
    plsql = false;
    leadingWords.length = 0;
  };

  while (index < length) {
    const ch = sql[index];

    if (segmentStart < 0) {
      if (isSpace(ch)) {
        index += 1;
        continue;
      }
      segmentStart = index;
    }

    if (ch === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline < 0 ? length : newline + 1;
      continue;
    }

    if (ch === "/" && sql[index + 1] === "*") {
      index += 2;
      let depth = 1;
      while (index < length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) {
        unterminated = true;
        break;
      }
      continue;
    }

    if (dialect === "oracle") {
      if (ch === "/") {
        const lineStart = sql.lastIndexOf("\n", index - 1) + 1;
        const lineEnd = sql.indexOf("\n", index);
        const end = lineEnd < 0 ? length : lineEnd;
        if (!sql.slice(lineStart, index).trim() && !sql.slice(index + 1, end).trim()) {
          flush(index);
          index = end;
          continue;
        }
      }
      const quoteStart = ch === "n" || ch === "N" ? index + 1 : index;
      if (
        /q/i.test(sql[quoteStart]) &&
        sql[quoteStart + 1] === "'" &&
        !isWordChar(sql[index - 1])
      ) {
        const opening = sql[quoteStart + 2];
        if (opening && !isSpace(opening)) {
          const closing =
            ({ "[": "]", "{": "}", "(": ")", "<": ">" } as Record<string, string>)[opening] ??
            opening;
          const end = sql.indexOf(`${closing}'`, quoteStart + 3);
          hasCode = true;
          if (end < 0) {
            unterminated = true;
            break;
          }
          index = end + 2;
          continue;
        }
      }
      if (/[A-Za-z_]/.test(ch)) {
        const start = index;
        while (index < length && isWordChar(sql[index])) index += 1;
        if (leadingWords.length < 6) leadingWords.push(sql.slice(start, index).toUpperCase());
        const first = leadingWords[0];
        const object = leadingWords
          .slice(1)
          .find((word) => !["OR", "REPLACE", "EDITIONABLE", "NONEDITIONABLE"].includes(word));
        plsql ||=
          first === "BEGIN" ||
          first === "DECLARE" ||
          (first === "CREATE" &&
            object !== undefined &&
            ["PACKAGE", "PROCEDURE", "FUNCTION", "TRIGGER", "TYPE"].includes(object));
        hasCode = true;
        continue;
      }
    }

    if (ch === "'") {
      hasCode = true;
      const prev = sql[index - 1];
      const backslashEscapes =
        dialect !== "oracle" &&
        (prev === "E" || prev === "e") &&
        !isWordChar(sql[index - 2]) &&
        sql[index - 2] !== ".";
      index += 1;
      let closed = false;
      while (index < length) {
        const cur = sql[index];
        if (backslashEscapes && cur === "\\") {
          index += 2;
          continue;
        }
        if (cur === "'") {
          if (sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        unterminated = true;
        break;
      }
      continue;
    }

    if (ch === '"') {
      hasCode = true;
      index += 1;
      let closed = false;
      while (index < length) {
        if (sql[index] === '"') {
          if (sql[index + 1] === '"') {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        unterminated = true;
        break;
      }
      continue;
    }

    if (dialect !== "oracle" && ch === "$" && !isWordChar(sql[index - 1])) {
      const match = DOLLAR_TAG_ASCII.exec(sql.slice(index));
      if (match) {
        hasCode = true;
        const tag = match[0];
        const closing = sql.indexOf(tag, index + tag.length);
        if (closing < 0) {
          unterminated = true;
          break;
        }
        index = closing + tag.length;
        continue;
      }
    }

    if (ch === ";") {
      index += 1;
      if (!plsql) flush(index);
      continue;
    }

    if (!isSpace(ch)) hasCode = true;
    index += 1;
  }

  if (unterminated) {
    return { statements, unterminated: true };
  }

  flush(length);
  return { statements, unterminated: false };
}

export function statementAtOffset(
  sql: string,
  offset: number,
  dialect?: string,
): SqlStatement | null {
  const { statements, unterminated } = splitSqlStatements(sql, dialect);
  if (unterminated) return null;
  const position = Math.max(0, Math.min(offset, sql.length));
  for (const statement of statements) {
    if (position >= statement.start && position <= statement.end) return statement;
  }
  return null;
}

export function sqlToRun(sql: string, selectedSql: string): string {
  return selectedSql.trim() ? selectedSql : sql;
}

export interface StatementSummary {
  kind: string;
  preview: string;
}

const STATEMENT_LEAD_PATTERN = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/|\(\s*)*([A-Za-z]+)/;

export function summarizeStatement(text: string): StatementSummary {
  const trimmed = text.trim();
  const match = STATEMENT_LEAD_PATTERN.exec(trimmed);
  const kind = match ? match[1].toUpperCase() : "SQL";
  const firstLine = trimmed.split("\n")[0].trim();
  const preview =
    firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "Leeres Statement";
  return { kind, preview };
}

const DML_PATTERN = /^(INSERT|UPDATE|DELETE)\b/i;
const DDL_PATTERN = /^(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;
const CREATE_VIEW_PATTERN = /^CREATE(\s+OR\s+REPLACE)?(\s+(TEMP|TEMPORARY|RECURSIVE))*\s+VIEW\b/i;
const IMPLICIT_DDL_COMMIT = new Set(["oracle", "mysql", "clickhouse", "cassandra"]);

export function isTransactionalStatement(sql: string, kind?: string): boolean {
  const trimmed = sql.trim();
  const lead = STATEMENT_LEAD_PATTERN.exec(trimmed);
  const text = lead ? trimmed.slice(lead[0].length - lead[1].length) : trimmed;
  if (DML_PATTERN.test(text)) return true;
  if (!DDL_PATTERN.test(text)) return false;
  return !CREATE_VIEW_PATTERN.test(text) && !IMPLICIT_DDL_COMMIT.has(kind ?? "");
}
