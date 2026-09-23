export function detectPlaceholders(sql: string, kind: string | null | undefined): string[] {
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  let pattern: RegExp | null = null;
  switch (kind) {
    case "postgres":
      pattern = /\$(\d+)/g;
      break;
    case "oracle":
      pattern = /(?<![:\w]):(\w+)/g;
      break;
    case "mssql":
      pattern = /@(\w+)/g;
      break;
    case "mysql":
      pattern = /\?/g;
      break;
    default:
      return [];
  }
  const found: string[] = [];
  let anonymous = 0;
  for (const match of stripped.matchAll(pattern)) {
    const name = match[0] === "?" ? `?${++anonymous}` : match[0];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

export function numberPlaceholders(sql: string, kind: string | null | undefined): string {
  if (kind !== "oracle") return sql;
  const names = detectPlaceholders(sql, kind);
  if (names.length === 0) return sql;
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char === "'" || char === '"') {
      const end = skipQuoted(sql, index, char);
      out += sql.slice(index, end);
      index = end;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    const previous = index > 0 ? sql[index - 1] : "";
    if (char === ":" && !/[:\w]/.test(previous)) {
      const match = /^\w+/.exec(sql.slice(index + 1));
      const position = match ? names.indexOf(`:${match[0]}`) : -1;
      if (match && position >= 0) {
        out += `$${position + 1}`;
        index += match[0].length + 1;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}
