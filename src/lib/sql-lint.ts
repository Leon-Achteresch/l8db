import type { TableInfo } from "@/lib/db";

export interface SqlLint {
  offset: number;
  length: number;
  message: string;
}

const REF_PATTERN = /(?:FROM|JOIN)\s+([A-Za-z_][\w$]*|"[^"]+")(?:\.([A-Za-z_][\w$]*|"[^"]+"))?/gi;
const CTE_PATTERN = /(?:WITH|,)\s+([A-Za-z_][\w$]*)\s+AS\s*\(/gi;

function unquote(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name;
}

function collectCtes(sql: string): Set<string> {
  const names = new Set<string>();
  CTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CTE_PATTERN.exec(sql)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

export function lintUnknownTables(sql: string, tables: TableInfo[]): SqlLint[] {
  if (tables.length === 0) return [];
  const known = new Map<string, Set<string>>();
  for (const table of tables) {
    const key = table.name.toLowerCase();
    if (!known.has(key)) known.set(key, new Set());
    known.get(key)?.add(table.schema.toLowerCase());
  }
  const ctes = collectCtes(sql);
  const findings: SqlLint[] = [];
  REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_PATTERN.exec(sql)) !== null) {
    const first = unquote(match[1]);
    const second = match[2] ? unquote(match[2]) : null;
    const tableName = (second ?? first).toLowerCase();
    const schemaName = second ? first.toLowerCase() : null;
    if (ctes.has(tableName)) continue;
    const after = sql.slice(match.index + match[0].length).trimStart();
    if (after.startsWith("(")) continue;
    const schemas = known.get(tableName);
    if (!schemas) {
      findings.push({
        offset: match.index + match[0].lastIndexOf(match[2] ?? match[1]),
        length: (match[2] ?? match[1]).length,
        message: `Unbekannte Tabelle: ${second ?? first}`,
      });
      continue;
    }
    if (schemaName && !schemas.has(schemaName)) {
      findings.push({
        offset: match.index,
        length: match[1].length,
        message: `Unbekanntes Schema für diese Tabelle: ${first}`,
      });
    }
  }
  return findings;
}
