import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

const LIMIT_DIALECTS = new Set([
  "postgres",
  "mysql",
  "sqlite",
  "sqlite_http",
  "duckdb",
  "clickhouse",
  "cassandra",
  "athena",
  "bigquery",
  "snowflake",
  "s3",
]);

export function applySelectRowLimit(sql: string, dialect: string, limit: number): string {
  if (["redis", "mongodb", "elasticsearch", "influxdb", "dynamodb"].includes(dialect)) return sql;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100000) return sql;
  const split = splitSqlStatements(sql, dialect);
  if (split.unterminated) return sql;
  let result = sql;
  for (const statement of [...split.statements].reverse()) {
    const tokens = sqlTokens(statement.text, dialect);
    const words = tokens.filter((token) => token.depth === 0);
    if (!["SELECT", "WITH"].includes(words[0]?.word)) continue;
    if (!words.some((token) => token.word === "SELECT")) continue;
    if (
      tokens.some(
        (token, index) =>
          ["INSERT", "DELETE", "MERGE", "INTO"].includes(token.word) ||
          (token.word === "UPDATE" &&
            tokens[index - 1]?.word !== "FOR" &&
            tokens[index - 1]?.word !== "KEY"),
      )
    )
      continue;
    if (words.some((token) => ["LIMIT", "TOP", "FETCH"].includes(token.word))) continue;
    let clause: string;
    if (LIMIT_DIALECTS.has(dialect)) clause = `LIMIT ${limit}`;
    else if (dialect === "oracle") clause = `FETCH FIRST ${limit} ROWS ONLY`;
    else if (dialect === "mssql") {
      const hasOrder = words.some(
        (token, index) => token.word === "ORDER" && words[index + 1]?.word === "BY",
      );
      const hasOffset = words.some((token) => token.word === "OFFSET");
      clause = `${hasOrder ? "" : "ORDER BY 1 "}${hasOffset ? "" : "OFFSET 0 ROWS "}FETCH NEXT ${limit} ROWS ONLY`;
    } else {
      throw new Error(
        "Automatisches Zeilenlimit für diesen SQL-Dialekt nicht verfügbar. Bitte das Limit im SQL setzen oder „Ohne Limit“ wählen.",
      );
    }
    const boundary = words.find((token, index) => {
      const next = words[index + 1]?.word;
      if (token.word === ";") return true;
      if (token.word === "FOR")
        return ["UPDATE", "SHARE", "NO", "KEY", "JSON", "XML"].includes(next);
      if (dialect === "cassandra" && token.word === "ALLOW" && next === "FILTERING") return true;
      if (dialect === "mssql" && token.word === "OPTION" && next === ")") return true;
      if (dialect === "clickhouse" && ["FORMAT", "SETTINGS"].includes(token.word)) {
        return (
          index > 0 &&
          !["SELECT", "FROM", "JOIN", "AS"].includes(words[index - 1].word) &&
          !["FROM", "AS", ";"].includes(next)
        );
      }
      return token.word === "OFFSET" && dialect !== "mssql" && dialect !== "oracle";
    });
    const offset = statement.start + (boundary?.start ?? statement.text.length);
    result = `${result.slice(0, offset)}\n${clause}\n${result.slice(offset)}`;
  }
  return result;
}
