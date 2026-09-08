import { aliasMap, SQL_KEYWORDS, type SqlObjectRegistry } from "@/lib/sql-intellisense";

const RESERVED = new Set<string>([
  ...SQL_KEYWORDS.flatMap((k) => k.split(" ")),
  "IS",
  "NULL",
  "AS",
  "ON",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "ALL",
  "ANY",
  "SOME",
  "ONLY",
  "FIRST",
  "NEXT",
  "ROWS",
  "ROW",
  "FETCH",
  "MINUS",
  "INTERSECT",
  "EXCEPT",
  "CONNECT",
  "START",
  "PRIOR",
  "NULLS",
  "LAST",
  "OVER",
  "PARTITION",
  "ESCAPE",
  "TRUE",
  "FALSE",
  "SYSDATE",
  "SYSTIMESTAMP",
  "ROWNUM",
  "ROWID",
  "LEVEL",
  "USER",
  "DUAL",
  "CURRENT_DATE",
  "CURRENT_TIMESTAMP",
  "LOCALTIMESTAMP",
  "INTERVAL",
  "DAY",
  "MONTH",
  "YEAR",
  "HOUR",
  "MINUTE",
  "SECOND",
  "DATE",
  "TIMESTAMP",
  "CAST",
  "OUTER",
  "NATURAL",
  "USING",
  "LATERAL",
  "PIVOT",
  "UNPIVOT",
  "FOR",
  "OF",
  "NOWAIT",
  "SKIP",
  "LOCKED",
  "WAIT",
  "COLLECT",
  "BULK",
]);

const IDENT = /^[A-Za-z_][\w$#]*/;

export function selectAtOffset(text: string, offset: number): string | null {
  const start = text.lastIndexOf(";", Math.max(0, offset - 1)) + 1;
  const endIndex = text.indexOf(";", offset);
  const segment = text.slice(start, endIndex === -1 ? text.length : endIndex);
  const local = offset - start;
  const starts = [...segment.matchAll(/\bselect\b/gi)]
    .map((m) => m.index)
    .filter((i) => i <= local)
    .reverse();
  for (const from of starts) {
    let body = segment.slice(from);
    let depth = 0;
    for (let i = 0; i < body.length; i += 1) {
      if (body[i] === "(") depth += 1;
      else if (body[i] === ")") {
        if (depth === 0) {
          body = body.slice(0, i);
          break;
        }
        depth -= 1;
      }
    }
    if (from + body.length >= local) return body.trim();
  }
  return null;
}

export function stripInto(sql: string): string {
  return sql.replace(
    /\s+(?:bulk\s+collect\s+)?into\s+[\w$#."]+(?:\s*,\s*[\w$#."]+)*(?=\s+from\b)/i,
    "",
  );
}

export function parameterizeVariables(sql: string, registry: SqlObjectRegistry): string {
  const aliases = aliasMap(sql);
  const referenced = new Set<string>();
  for (const [alias, table] of aliases) {
    referenced.add(alias.toLowerCase());
    referenced.add(table.toLowerCase());
  }
  for (const m of sql.matchAll(/\b(?:from|join)\s+(?:[\w$#"]+\.)?([\w$#"]+)/gi)) {
    referenced.add(m[1].replace(/"/g, "").toLowerCase());
  }
  const columns = new Set<string>();
  for (const c of registry.columns) {
    if (referenced.has(c.table.toLowerCase())) columns.add(c.name.toLowerCase());
  }
  if (columns.size === 0) return sql;
  const known = (word: string) => {
    const lower = word.toLowerCase();
    return (
      RESERVED.has(word.toUpperCase()) ||
      referenced.has(lower) ||
      columns.has(lower) ||
      registry.schemas.some((s) => s.toLowerCase() === lower) ||
      registry.tables.some((t) => t.name.toLowerCase() === lower) ||
      registry.views.some((t) => t.name.toLowerCase() === lower)
    );
  };

  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const rest = sql.slice(i);
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (rest.startsWith("--")) {
      const j = sql.indexOf("\n", i);
      const end = j === -1 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const j = sql.indexOf("*/", i + 2);
      const end = j === -1 ? sql.length : j + 2;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (/[\d:]/.test(c)) {
      const m = /^[\w$#.:]+/.exec(rest);
      const len = m ? m[0].length : 1;
      out += sql.slice(i, i + len);
      i += len;
      continue;
    }
    const m = IDENT.exec(rest);
    if (!m) {
      out += c;
      i += 1;
      continue;
    }
    const parts = [m[0]];
    let len = m[0].length;
    for (;;) {
      const dotted = /^\s*\.\s*([A-Za-z_][\w$#]*)/.exec(rest.slice(len));
      if (!dotted) break;
      parts.push(dotted[1]);
      len += dotted[0].length;
    }
    const after = rest.slice(len);
    const isCall = /^\s*\(/.test(after);
    const isVariable = !isCall && !known(parts[0]);
    out += isVariable ? `:${parts.join("_")}` : rest.slice(0, len);
    i += len;
  }
  return out;
}

export function selectForResults(
  text: string,
  offset: number,
  registry: SqlObjectRegistry,
): string | null {
  const raw = selectAtOffset(text, offset);
  if (!raw) return null;
  return parameterizeVariables(stripInto(raw), registry);
}
