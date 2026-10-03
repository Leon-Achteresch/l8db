import { splitSqlStatements } from "@/lib/sql-statements";

interface Token {
  word: string;
  depth: number;
  start: number;
}

export function sqlTokens(sql: string, dialect?: string, comments?: [number, number][]): Token[] {
  const result: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const tokenStart = i;
    const c = sql[i];
    if (sql.startsWith("--", i) || (dialect === "mysql" && c === "#")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      comments?.push([tokenStart, i]);
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
      comments?.push([tokenStart, i]);
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
      result.push({ word: "identifier", depth, start: tokenStart });
    } else if (c === "(") {
      depth++;
      i++;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      result.push({ word: ")", depth, start: tokenStart });
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[\w$]/.test(sql[i])) i++;
      result.push({ word: sql.slice(start, i).toUpperCase(), depth, start });
    } else {
      if (c === ";") result.push({ word: ";", depth, start: tokenStart });
      i++;
    }
  }
  return result;
}

export interface DestructiveStatement {
  sql: string;
  reason: string;
}

function withoutWhere(words: Token[], index: number): boolean {
  const token = words[index];
  for (let j = index + 1; j < words.length; j++) {
    const next = words[j];
    if (
      next.depth < token.depth ||
      (next.depth === token.depth && [";", "RETURNING"].includes(next.word))
    )
      break;
    if (next.depth === token.depth && next.word === "WHERE") return false;
  }
  return true;
}

export interface SafetyOptions {
  strict?: boolean;
}

export function destructiveStatements(
  sql: string,
  dialect?: string,
  options: SafetyOptions = {},
): DestructiveStatement[] {
  if (dialect === "redis" || dialect === "mongodb") return [];
  return splitSqlStatements(sql, dialect).statements.flatMap((statement) => {
    const words = sqlTokens(statement.text, dialect);
    let reason: string | null = null;
    if (["GRANT", "REVOKE"].includes(words[0]?.word)) return [];
    for (let i = 0; i < words.length; i++) {
      const token = words[i];
      if (token.word === "DROP" && words[i + 1]?.word === "TABLE") reason = "Tabelle löschen";
      else if (options.strict && token.word === "DROP" && i === 0) reason = "Objekt löschen";
      if (token.word === "TRUNCATE") reason = "Tabelle leeren";
      if (token.word === "DELETE" && withoutWhere(words, i)) reason = "DELETE ohne WHERE";
      if (options.strict && token.word === "UPDATE" && withoutWhere(words, i))
        reason = "UPDATE ohne WHERE";
      if (options.strict && token.word === "ALTER" && i === 0) reason = "Struktur ändern";
    }
    return reason ? [{ sql: statement.text, reason }] : [];
  });
}

const READ_WORDS = new Set([
  "SELECT",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "VALUES",
  "TABLE",
  "USE",
  "PRAGMA",
]);
const MODIFYING_WORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "INTO"]);
const MONGO_WRITE =
  /\.(insert|insertOne|insertMany|update|updateOne|updateMany|replaceOne|delete|deleteOne|deleteMany|remove|drop|dropDatabase|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createCollection|createIndex|createIndexes|dropIndex|dropIndexes|renameCollection)\s*\(|"(insert|update|delete|drop|create|createIndexes|findAndModify|renameCollection|dropDatabase)"\s*:/;
const REDIS_READ = new Set([
  "GET",
  "MGET",
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "SCAN",
  "HSCAN",
  "SSCAN",
  "ZSCAN",
  "KEYS",
  "TYPE",
  "TTL",
  "PTTL",
  "EXISTS",
  "STRLEN",
  "LRANGE",
  "LLEN",
  "LINDEX",
  "SMEMBERS",
  "SCARD",
  "SISMEMBER",
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZREVRANGE",
  "ZCARD",
  "ZSCORE",
  "XRANGE",
  "XREVRANGE",
  "XLEN",
  "INFO",
  "PING",
  "DBSIZE",
  "MEMORY",
  "OBJECT",
  "GETRANGE",
]);

export function writesData(sql: string, dialect?: string): boolean {
  const text = sql.trim();
  if (!text) return false;
  if (dialect === "mongodb") return MONGO_WRITE.test(text);
  if (dialect === "redis")
    return text
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0]?.toUpperCase() ?? "")
      .some((word) => word && !REDIS_READ.has(word));
  return splitSqlStatements(text, dialect).statements.some((statement) => {
    const explained = explainedStatement(statement.text, dialect);
    if (explained !== null) return !explained || writesData(explained, dialect);
    const words = sqlTokens(statement.text, dialect);
    const first = words[0]?.word;
    if (!first) return false;
    if (first === "WITH" || first === "SELECT")
      return words.some((token) => MODIFYING_WORDS.has(token.word));
    return !READ_WORDS.has(first);
  });
}

const EXPLAINABLE_WORDS = new Set([
  "SELECT",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "REPLACE",
  "CREATE",
  "TABLE",
  "VALUES",
  "EXECUTE",
  "DECLARE",
  "CALL",
]);

function explainedStatement(text: string, dialect?: string): string | null {
  const words = sqlTokens(text, dialect);
  if (words[0]?.word !== "EXPLAIN") return null;
  const index = words.findIndex(
    (token, position) => position > 0 && token.depth === 0 && EXPLAINABLE_WORDS.has(token.word),
  );
  const options = words.slice(1, index < 0 ? undefined : index);
  if (!options.some((token) => token.word === "ANALYZE" || token.word === "ANALYSE")) return null;
  return index < 0 ? "" : text.slice(words[index].start);
}

export function analyzedSql(sql: string, dialect?: string): string {
  if (dialect === "redis" || dialect === "mongodb") return sql;
  const { statements } = splitSqlStatements(sql, dialect);
  if (!statements.some((statement) => explainedStatement(statement.text, dialect))) return sql;
  return statements
    .map((statement) => explainedStatement(statement.text, dialect) || statement.text)
    .map((text) => text.trim().replace(/;\s*$/, ""))
    .join(";\n");
}

const TRANSACTION_CONTROL_MESSAGE =
  "Transaktionsbefehle im Skript bitte entfernen und die Transaktionswahl des Dialogs verwenden.";
const IMPLICIT_COMMIT_MESSAGE =
  "Dieses Skript enthält DDL mit implizitem Commit. Bitte vorhandene Transaktionen abschließen und Autocommit wählen.";
const QUERY_TRANSACTION_CONTROL_MESSAGE =
  "Transaktionsbefehle bitte nicht im Editor ausführen, solange Transaktionen verwaltet werden. Commit und Rollback über das Transaktionspanel auslösen.";
const QUERY_IMPLICIT_COMMIT_MESSAGE =
  "Diese Anweisung löst einen impliziten Commit aus und kann nicht in einer verwalteten Transaktion laufen. Offene Transaktion über das Transaktionspanel abschließen oder DDL getrennt ausführen.";

const IMPLICIT_COMMIT_WORDS: Record<string, Set<string>> = {
  mysql: new Set([
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "RENAME",
    "LOCK",
    "UNLOCK",
    "ANALYZE",
    "OPTIMIZE",
    "REPAIR",
    "FLUSH",
    "INSTALL",
    "UNINSTALL",
  ]),
  oracle: new Set([
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "RENAME",
    "COMMENT",
    "ANALYZE",
    "AUDIT",
    "NOAUDIT",
    "PURGE",
    "FLASHBACK",
  ]),
  clickhouse: new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE"]),
  cassandra: new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE"]),
};

const ROUTINE_WORDS = new Set(["PROC", "PROCEDURE", "TRIGGER", "FUNCTION"]);
const GO_LINE = /^[ \t]*GO(?:[ \t]+\d+)?[ \t]*$/im;
const END_COMMITS = new Set(["postgres", "sqlite", "sqlite_http"]);

function definesRoutine(words: Token[]): boolean {
  const first = words[0]?.word;
  if (first !== "CREATE" && first !== "ALTER") return false;
  const object = first === "CREATE" && words[1]?.word === "OR" ? words[3] : words[1];
  return object !== undefined && ROUTINE_WORDS.has(object.word);
}

function controlsTransaction(words: Token[], dialect: string, managed: boolean): boolean {
  const first = words[0]?.word;
  const second = words[1]?.word;
  if (
    ["COMMIT", "ROLLBACK", "ABORT"].includes(first) ||
    (first === "START" && second === "TRANSACTION") ||
    (first === "PREPARE" && second === "TRANSACTION") ||
    (first === "BEGIN" && !["oracle", "mssql"].includes(dialect)) ||
    (first === "BEGIN" &&
      dialect === "mssql" &&
      ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(second)) ||
    (first === "END" && END_COMMITS.has(dialect))
  )
    return true;
  if (!managed) return false;
  if (dialect === "mssql")
    return words.some(
      (token, index) =>
        ["COMMIT", "ROLLBACK"].includes(token.word) ||
        (token.word === "BEGIN" &&
          ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(words[index + 1]?.word)),
    );
  if (dialect === "oracle" && ["BEGIN", "DECLARE"].includes(first))
    return words.some((token) => ["COMMIT", "ROLLBACK"].includes(token.word));
  return false;
}

function commitsImplicitly(words: Token[], dialect: string): boolean {
  const first = words[0]?.word;
  if (dialect === "mysql") {
    if (["CREATE", "DROP"].includes(first) && words[1]?.word === "TEMPORARY") return false;
    if (first === "SET" && words.some((token) => token.word === "AUTOCOMMIT")) return true;
  }
  return IMPLICIT_COMMIT_WORDS[dialect]?.has(first) ?? false;
}

function transactionIssue(
  sql: string,
  dialect: string,
  managed: boolean,
): "control" | "implicit" | null {
  if (dialect === "redis" || dialect === "mongodb") return null;
  for (const statement of splitSqlStatements(sql, dialect).statements) {
    if (dialect === "mssql") {
      let routine = false;
      for (const [index, batch] of statement.text.split(GO_LINE).entries()) {
        if (index > 0) routine = false;
        const words = sqlTokens(batch, dialect);
        routine ||= definesRoutine(words);
        if (!routine && controlsTransaction(words, dialect, managed)) return "control";
      }
      continue;
    }
    const words = sqlTokens(statement.text, dialect);
    if (controlsTransaction(words, dialect, managed)) return "control";
    if (managed && commitsImplicitly(words, dialect)) return "implicit";
  }
  return null;
}

export function scriptPolicyIssue(sql: string, dialect: string, managed: boolean): string | null {
  const issue = transactionIssue(sql, dialect, managed);
  if (issue === "control") return TRANSACTION_CONTROL_MESSAGE;
  if (issue === "implicit") return IMPLICIT_COMMIT_MESSAGE;
  return null;
}

export function managedQueryIssue(sql: string, dialect: string): string | null {
  const issue = transactionIssue(sql, dialect, true);
  if (issue === "control") return QUERY_TRANSACTION_CONTROL_MESSAGE;
  if (issue === "implicit") return QUERY_IMPLICIT_COMMIT_MESSAGE;
  return null;
}
