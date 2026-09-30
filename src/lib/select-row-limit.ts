import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

export const DEFAULT_SELECT_ROW_LIMIT = 1000;

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

export function applySelectRowLimit(
  sql: string,
  dialect: string,
  limit = DEFAULT_SELECT_ROW_LIMIT,
): string {
  if (["redis", "mongodb", "elasticsearch", "influxdb", "dynamodb", "odbc"].includes(dialect))
    return sql;
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
    const selectIndex = words.findIndex((token) => token.word === "SELECT");
    const hasNativeLimit = words.some((token, index) => {
      if (token.word === "TOP")
        return (
          index === selectIndex + 1 ||
          (index === selectIndex + 2 && ["DISTINCT", "ALL"].includes(words[selectIndex + 1].word))
        );
      if (token.word === "FETCH") return ["FIRST", "NEXT"].includes(words[index + 1]?.word);
      const following = statement.text
        .slice(token.start + token.word.length)
        .replace(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$))+/g, "");
      if (token.word === "LIMIT") {
        if (dialect === "cassandra" && words[index - 1]?.word === "PARTITION") return false;
        if (dialect === "clickhouse" && words[index + 1]?.word === "BY") return false;
        return /^\s*(?:[-+]?\d|\(|[?$:@{]|ALL\b|NULL\b)/i.test(following);
      }
      return (
        dialect === "oracle" &&
        token.word === "ROWNUM" &&
        /^\s*(?:<=?|=|BETWEEN\b)/i.test(following)
      );
    });
    const hasRownumLimit =
      dialect === "oracle" &&
      tokens.some((token, index) => {
        if (token.word !== "ROWNUM") return false;
        const select = tokens
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.word === "SELECT" && candidate.depth <= token.depth);
        if (select?.depth !== 0) return false;
        const following = statement.text.slice(token.start + token.word.length);
        const preceding = statement.text.slice(0, token.start);
        return /^\s*(?:<=?|=|BETWEEN\b)/i.test(following) || />=?\s*$/.test(preceding);
      });
    if (hasNativeLimit || hasRownumLimit) continue;
    if (dialect === "oracle" && words.some((token) => token.word === "FOR")) {
      const boundary = words.find((token) =>
        ["GROUP", "HAVING", "ORDER", "FOR", ";"].includes(token.word),
      );
      const end = boundary?.start ?? statement.text.length;
      const where = words.find((token) => token.word === "WHERE");
      const offset = statement.start + end;
      if (where) {
        const start = statement.start + where.start + where.word.length;
        result = `${result.slice(0, start)} ( ${result.slice(start, offset)}\n) AND ROWNUM <= ${limit}\n${result.slice(offset)}`;
      } else {
        result = `${result.slice(0, offset)}\nWHERE ROWNUM <= ${limit}\n${result.slice(offset)}`;
      }
      continue;
    }
    let clause: string;
    if (LIMIT_DIALECTS.has(dialect)) clause = `LIMIT ${limit}`;
    else if (dialect === "oracle") clause = `FETCH FIRST ${limit} ROWS ONLY`;
    else if (dialect === "mssql") {
      const hasOffset = words.some((token) => token.word === "OFFSET");
      const compound = words.some((token) => ["UNION", "EXCEPT", "INTERSECT"].includes(token.word));
      if (!hasOffset && !compound) {
        const select = words[selectIndex];
        const modifier = words[selectIndex + 1];
        const insertion =
          modifier && ["DISTINCT", "ALL"].includes(modifier.word) ? modifier : select;
        const offset = statement.start + insertion.start + insertion.word.length;
        result = `${result.slice(0, offset)} TOP (${limit})${result.slice(offset)}`;
        continue;
      }
      const hasOrder = words.some(
        (token, index) => token.word === "ORDER" && words[index + 1]?.word === "BY",
      );
      clause = `${hasOrder ? "" : "ORDER BY 1 "}${hasOffset ? "" : "OFFSET 0 ROWS "}FETCH NEXT ${limit} ROWS ONLY`;
    } else {
      throw new Error(
        "Automatisches Zeilenlimit für diesen SQL-Dialekt nicht verfügbar. Bitte das Limit im SQL setzen.",
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
