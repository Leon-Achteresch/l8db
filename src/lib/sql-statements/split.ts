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

const DOLLAR_TAG_ASCII = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
const DOLLAR_TAG_START = /[A-Za-z_$]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

const ROUTINE_OBJECTS = ["TRIGGER", "PROCEDURE", "FUNCTION", "EVENT"];
const MSSQL_BATCH_OBJECTS = ["PROCEDURE", "PROC", "FUNCTION", "TRIGGER"];
const END_SUFFIXES = ["IF", "LOOP", "WHILE", "REPEAT"];
const ORACLE_CREATE_MODIFIERS = ["OR", "REPLACE", "EDITIONABLE", "NONEDITIONABLE"];
const ORACLE_PLSQL_OBJECTS = ["PACKAGE", "PROCEDURE", "FUNCTION", "TRIGGER"];
const SQLPLUS_COMMANDS = new Set([
  "SET",
  "PROMPT",
  "SPOOL",
  "WHENEVER",
  "DEFINE",
  "UNDEFINE",
  "REM",
  "REMARK",
  "SHOW",
  "EXIT",
  "QUIT",
  "PAUSE",
  "ACCEPT",
  "COLUMN",
  "TTITLE",
  "BTITLE",
  "BREAK",
  "CLEAR",
  "TIMING",
]);
const SQL_SET_TARGETS = ["TRANSACTION", "ROLE", "CONSTRAINT", "CONSTRAINTS"];

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
  let plsqlDepth = 0;
  let plsqlPending = 0;
  let plsqlHeader = false;
  let plsqlClosed = false;
  let plsqlBody = false;
  let batch = false;
  let blockDepth = 0;
  let delimiter = ";";
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
    plsqlDepth = 0;
    plsqlPending = 0;
    plsqlHeader = false;
    plsqlClosed = false;
    plsqlBody = false;
    batch = false;
    blockDepth = 0;
    leadingWords.length = 0;
  };

  const lineEndFrom = (from: number) => {
    const newline = sql.indexOf("\n", from);
    return newline < 0 ? length : newline;
  };

  const readWord = (from: number) => {
    let end = from;
    while (end < length && isWordChar(sql[end])) end += 1;
    return end;
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

    if (delimiter !== ";" && sql.startsWith(delimiter, index)) {
      flush(index);
      index += delimiter.length;
      continue;
    }

    if ((ch === "-" && sql[index + 1] === "-") || (dialect === "mysql" && ch === "#")) {
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
        while (
          index < length &&
          (isWordChar(sql[index]) || sql[index] === "$" || sql[index] === "#")
        )
          index += 1;
        if (sql[start - 1] === "$") {
          hasCode = true;
          continue;
        }
        const word = sql.slice(start, index).toUpperCase();
        if (!hasCode && SQLPLUS_COMMANDS.has(word)) {
          const lineStart = sql.lastIndexOf("\n", start - 1) + 1;
          let next = index;
          while (next < length && isSpace(sql[next])) next += 1;
          const target = sql.slice(next, readWord(next)).toUpperCase();
          if (
            !sql.slice(lineStart, start).trim() &&
            !(word === "SET" && SQL_SET_TARGETS.includes(target))
          ) {
            segmentStart = -1;
            index = lineEndFrom(index);
            continue;
          }
        }
        hasCode = true;
        if (!plsql) {
          if (leadingWords.length < 6) leadingWords.push(word);
          const first = leadingWords[0];
          const objectIndex = leadingWords.findIndex(
            (w, i) => i > 0 && !ORACLE_CREATE_MODIFIERS.includes(w),
          );
          const object = objectIndex > 0 ? leadingWords[objectIndex] : undefined;
          plsql =
            first === "BEGIN" ||
            first === "DECLARE" ||
            (first === "CREATE" &&
              object !== undefined &&
              (ORACLE_PLSQL_OBJECTS.includes(object) ||
                (object === "TYPE" && leadingWords[objectIndex + 1] === "BODY")));
          if (plsql) {
            plsqlDepth = 1;
            plsqlBody = first === "BEGIN";
          }
          continue;
        }
        if ((word === "PROCEDURE" || word === "FUNCTION") && plsqlDepth === 1) plsqlHeader = true;
        else if ((word === "IS" || word === "AS") && plsqlHeader) {
          plsqlHeader = false;
          plsqlPending += 1;
        } else if (word === "BEGIN") {
          if (plsqlDepth > 1) plsqlDepth += 1;
          else if (plsqlPending > 0) {
            plsqlDepth += 1;
            plsqlPending -= 1;
          } else if (plsqlBody) plsqlDepth += 1;
          else plsqlBody = true;
        } else if (word === "CASE") plsqlDepth += 1;
        else if (word === "END") {
          let next = index;
          while (next < length && isSpace(sql[next])) next += 1;
          const nextEnd = readWord(next);
          const suffix = sql.slice(next, nextEnd).toUpperCase();
          if (suffix === "IF" || suffix === "LOOP") {
            index = nextEnd;
            continue;
          }
          if (suffix === "CASE") index = nextEnd;
          plsqlDepth = Math.max(0, plsqlDepth - 1);
          if (plsqlDepth === 0) plsqlClosed = true;
        }
        continue;
      }
    }

    if (dialect !== "oracle" && /[A-Za-z_]/.test(ch) && !isWordChar(sql[index - 1])) {
      const start = index;
      index = readWord(start);
      const word = sql.slice(start, index).toUpperCase();
      if (dialect === "mssql" && word === "GO") {
        const lineStart = sql.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = lineEndFrom(index);
        const rest = sql.slice(index, lineEnd).trim();
        if (!sql.slice(lineStart, start).trim() && (!rest || rest.startsWith("--"))) {
          flush(start);
          index = lineEnd;
          continue;
        }
      }
      if (dialect === "mysql" && word === "DELIMITER" && !hasCode && leadingWords.length === 0) {
        const lineEnd = lineEndFrom(index);
        const next = sql.slice(index, lineEnd).trim().split(/\s+/)[0];
        if (next && isSpace(sql[index] ?? "")) {
          delimiter = next;
          segmentStart = -1;
          index = lineEnd;
          continue;
        }
      }
      hasCode = true;
      if (leadingWords.length < 8) leadingWords.push(word);
      const first = leadingWords[0];
      if (dialect === "mssql") {
        const object = leadingWords.slice(1).find((w) => w !== "OR" && w !== "ALTER");
        batch ||=
          (first === "CREATE" || first === "ALTER") &&
          object !== undefined &&
          MSSQL_BATCH_OBJECTS.includes(object);
        continue;
      }
      const prev = sql[start - 1];
      if (
        first !== "CREATE" ||
        prev === "." ||
        prev === "@" ||
        !leadingWords.slice(1).some((w) => ROUTINE_OBJECTS.includes(w))
      )
        continue;
      if (word === "BEGIN" || word === "CASE") blockDepth += 1;
      else if (word === "END") {
        let next = index;
        while (next < length && isSpace(sql[next])) next += 1;
        const nextEnd = readWord(next);
        const suffix = sql.slice(next, nextEnd).toUpperCase();
        if (END_SUFFIXES.includes(suffix)) {
          index = nextEnd;
          continue;
        }
        if (suffix === "CASE") index = nextEnd;
        blockDepth = Math.max(0, blockDepth - 1);
      }
      continue;
    }

    if (ch === "'") {
      hasCode = true;
      const prev = sql[index - 1];
      const backslashEscapes =
        dialect === "mysql" ||
        (dialect !== "oracle" &&
          (prev === "E" || prev === "e") &&
          !isWordChar(sql[index - 2]) &&
          sql[index - 2] !== ".");
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

    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      hasCode = true;
      index += 1;
      let closed = false;
      while (index < length) {
        if (dialect === "mysql" && sql[index] === "\\") {
          index += 2;
          continue;
        }
        if (sql[index] === close) {
          if (sql[index + 1] === close) {
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

    if (
      dialect !== "oracle" &&
      ch === "$" &&
      DOLLAR_TAG_START.test(sql[index + 1] ?? "") &&
      !isWordChar(sql[index - 1])
    ) {
      DOLLAR_TAG_ASCII.lastIndex = index;
      const match = DOLLAR_TAG_ASCII.exec(sql);
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
      plsqlHeader = false;
      if ((!plsql || plsqlClosed) && !batch && blockDepth === 0 && delimiter === ";") flush(index);
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
  const last = statements.at(-1);
  if (last && position > last.end && !sql.slice(last.end, position).trim()) return last;
  return null;
}

export function runsOneStatementPerCall(dialect?: string): boolean {
  return dialect === "oracle";
}

export function sqlToRun(sql: string, selectedSql: string): string {
  return selectedSql.trim() ? selectedSql : sql;
}
