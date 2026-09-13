import { splitSqlStatements } from "@/lib/sql-statements";

interface Token {
  word: string;
  depth: number;
}

function tokens(sql: string, dialect?: string): Token[] {
  const result: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (sql.startsWith("--", i) || (dialect === "mysql" && c === "#")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting) {
        if (sql.startsWith("/*", i)) {
          nesting++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          nesting--;
          i += 2;
        } else i++;
      }
    } else if ((c === "q" || c === "Q") && sql[i + 1] === "'" && dialect === "oracle") {
      const opening = sql[i + 2];
      const closing =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opening] ?? opening;
      const end = sql.indexOf(`${closing}'`, i + 3);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "$" && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)![0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const backslashEscapes =
        dialect === "mysql" ||
        (c === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/[\w$]/.test(sql[i - 2] ?? ""));
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) i += 2;
          else {
            i++;
            break;
          }
        } else if (sql[i] === "\\" && backslashEscapes) i += 2;
        else i++;
      }
      result.push({ word: "identifier", depth });
    } else if (c === "(") {
      depth++;
      i++;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      result.push({ word: ")", depth });
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[\w$]/.test(sql[i])) i++;
      result.push({ word: sql.slice(start, i).toUpperCase(), depth });
    } else {
      if (c === ";") result.push({ word: ";", depth });
      i++;
    }
  }
  return result;
}

export interface DestructiveStatement {
  sql: string;
  reason: string;
}

export function destructiveStatements(sql: string, dialect?: string): DestructiveStatement[] {
  if (dialect === "redis" || dialect === "mongodb") return [];
  return splitSqlStatements(sql, dialect).statements.flatMap((statement) => {
    const words = tokens(statement.text, dialect);
    let reason: string | null = null;
    if (["GRANT", "REVOKE"].includes(words[0]?.word)) return [];
    for (let i = 0; i < words.length; i++) {
      const token = words[i];
      if (token.word === "DROP" && words[i + 1]?.word === "TABLE") reason = "Tabelle löschen";
      if (token.word === "TRUNCATE") reason = "Tabelle leeren";
      if (token.word === "DELETE") {
        let hasWhere = false;
        for (let j = i + 1; j < words.length; j++) {
          const next = words[j];
          if (
            next.depth < token.depth ||
            (next.depth === token.depth && [";", "RETURNING"].includes(next.word))
          )
            break;
          if (next.depth === token.depth && next.word === "WHERE") hasWhere = true;
        }
        if (!hasWhere) reason = "DELETE ohne WHERE";
      }
    }
    return reason ? [{ sql: statement.text, reason }] : [];
  });
}

export function scriptPolicyIssue(sql: string, dialect: string, managed: boolean): string | null {
  for (const statement of splitSqlStatements(sql, dialect).statements) {
    const words = tokens(statement.text, dialect);
    const first = words[0]?.word;
    if (
      ["COMMIT", "ROLLBACK", "ABORT"].includes(first) ||
      (first === "START" && words[1]?.word === "TRANSACTION") ||
      (first === "BEGIN" && dialect !== "oracle") ||
      (first === "END" && dialect === "postgres")
    )
      return "Transaktionsbefehle im Skript bitte entfernen und die Transaktionswahl des Dialogs verwenden.";
    if (
      managed &&
      ["mysql", "oracle", "clickhouse", "cassandra"].includes(dialect) &&
      ["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE"].includes(first)
    )
      return "Dieses Skript enthält DDL mit implizitem Commit. Bitte vorhandene Transaktionen abschließen und Autocommit wählen.";
  }
  return null;
}
