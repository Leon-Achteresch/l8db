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

export function splitSqlStatements(sql: string): SqlSplitResult {
  const statements: SqlStatement[] = [];
  const length = sql.length;
  let index = 0;
  let segmentStart = -1;
  let hasCode = false;
  let unterminated = false;

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

    if (ch === "'") {
      hasCode = true;
      const prev = sql[index - 1];
      const backslashEscapes =
        (prev === "E" || prev === "e") && !isWordChar(sql[index - 2]) && sql[index - 2] !== ".";
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

    if (ch === "$" && !isWordChar(sql[index - 1])) {
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
      flush(index);
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

export function statementAtOffset(sql: string, offset: number): SqlStatement | null {
  const { statements, unterminated } = splitSqlStatements(sql);
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
