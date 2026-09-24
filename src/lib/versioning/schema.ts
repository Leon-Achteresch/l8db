import { splitSqlStatements } from "@/lib/sql-statements";
import { sqlCode } from "./sql-code";
import type { VersioningKind } from "./types";

export function assertMappedWriteScope(sql: string, schema: string, kind: VersioningKind) {
  const identifier = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$#]*)';
  const target = new RegExp(
    `^(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?|ALTER\\s+(?:TABLE(?:\\s+ONLY)?|MATERIALIZED\\s+VIEW|VIEW|INDEX|SEQUENCE|FUNCTION|PROCEDURE|PACKAGE(?:\\s+BODY)?)(?:\\s+IF\\s+EXISTS)?|DROP\\s+(?:TABLE|MATERIALIZED\\s+VIEW|VIEW|INDEX|SEQUENCE|FUNCTION|PROCEDURE|PACKAGE(?:\\s+BODY)?|SCHEMA)(?:\\s+IF\\s+EXISTS)?|CREATE(?:\\s+OR\\s+REPLACE)?\\s+(?:(?:UNIQUE\\s+)?INDEX|TABLE|MATERIALIZED\\s+VIEW|VIEW|SEQUENCE|FUNCTION|PROCEDURE|PACKAGE(?:\\s+BODY)?|TRIGGER)(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+(${identifier})\\s*\\.`,
    "i",
  );
  const indexTable = new RegExp(`\\bON\\s+(${identifier})\\s*\\.`, "i");
  for (const statement of splitSqlStatements(sql, kind).statements) {
    const code = sqlCode(statement.text);
    if (
      /^(?:DROP|TRUNCATE)\b/i.test(code) &&
      new RegExp(`,\\s*${identifier}\\s*\\.`, "i").test(code)
    )
      throw new Error("Mehrere schemaqualifizierte Ziele in einer Migration getrennt ausführen.");
    const matches = [target.exec(code)];
    if (/^CREATE(?:\s+OR\s+REPLACE)?\s+(?:(?:UNIQUE\s+)?INDEX|TRIGGER)\b/i.test(code))
      matches.push(indexTable.exec(code));
    for (const match of matches) {
      if (!match) continue;
      const name = match[1].startsWith('"')
        ? match[1].slice(1, -1).replaceAll('""', '"')
        : kind === "oracle"
          ? match[1].toUpperCase()
          : match[1].toLowerCase();
      if (name !== schema)
        throw new Error(
          `Migration schreibt in Schema ${name} statt in das zugeordnete Kundenschema ${schema}.`,
        );
    }
  }
}

export function requalify(sql: string, from: string, to: string): string {
  if (!from || !to) throw new Error("Schema-Zuordnung ist unvollständig.");
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    let opaque: string | undefined;
    if (rest.startsWith("--"))
      opaque = rest.slice(0, rest.indexOf("\n") < 0 ? rest.length : rest.indexOf("\n"));
    else if (rest.startsWith("/*")) {
      let end = 2;
      let depth = 1;
      while (end < rest.length && depth) {
        if (rest.slice(end, end + 2) === "/*") {
          depth += 1;
          end += 2;
        } else if (rest.slice(end, end + 2) === "*/") {
          depth -= 1;
          end += 2;
        } else end += 1;
      }
      opaque = rest.slice(0, end);
    } else if (/^q'/i.test(rest) && rest.length > 3) {
      const close =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[rest[2]] ?? rest[2];
      const end = rest.indexOf(`${close}'`, 3);
      opaque = end < 0 ? rest : rest.slice(0, end + 2);
    } else if (rest.startsWith("'")) {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === "'") {
          if (rest[end + 1] === "'") end += 2;
          else {
            end += 1;
            break;
          }
        } else if (rest[end] === "\\") end += 2;
        else end += 1;
      }
      opaque = rest.slice(0, end);
    } else {
      const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
      if (dollar) {
        const end = rest.indexOf(dollar, dollar.length);
        opaque = end < 0 ? rest : rest.slice(0, end + dollar.length);
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          from !== to &&
          new RegExp(`(?:"${escaped.replaceAll('"', '""')}"|\\b${escaped})\\s*\\.`, "i").test(
            opaque,
          )
        )
          throw new Error(
            "Schema-Zuordnung im Dollar-String erfordert eine ausdrücklich angepasste Migration.",
          );
      }
    }
    if (opaque !== undefined) {
      output += opaque;
      index += opaque.length;
      continue;
    }
    const token = /^(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$#]*)/.exec(rest)?.[0];
    if (token) {
      const name = token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token;
      const matches = token.startsWith('"')
        ? name === from
        : name.toLowerCase() === from.toLowerCase();
      output +=
        matches && /^\s*\./.test(rest.slice(token.length))
          ? `"${to.replaceAll('"', '""')}"`
          : token;
      index += token.length;
    } else {
      output += sql[index];
      index += 1;
    }
  }
  return output;
}
