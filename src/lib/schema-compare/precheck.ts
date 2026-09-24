import type { CatalogObject } from "@/lib/db";

export interface DataCheck {
  sql: string;
  message: string;
}

const NAME = `"(?:[^"]|"")+"`;

function identifiers(list: string): string[] | null {
  const parts = list.split(",").map((part) => part.trim().replace(/\s+(?:ASC|DESC)$/i, ""));
  return parts.every((part) => new RegExp(`^${NAME}$`).test(part)) ? parts : null;
}

function duplicates(table: string, columns: string[]): string {
  return `SELECT NVL(SUM(n), 0) FROM (SELECT COUNT(*) n FROM ${table} WHERE ${columns.map((column) => `${column} IS NOT NULL`).join(" OR ")} GROUP BY ${columns.join(", ")} HAVING COUNT(*) > 1)`;
}

export function keyCheck(
  body: string,
  table: string,
  referenceExists: (qualifiedName: string) => boolean,
): DataCheck | null {
  if (/\s(?:DISABLE|ENABLE NOVALIDATE)$/.test(body)) return null;
  const key = /^(PRIMARY KEY|UNIQUE)(?: ON \S+)? \(([^()]+)\)/.exec(body);
  if (key) {
    const columns = identifiers(key[2]);
    if (!columns) return null;
    if (key[1] === "UNIQUE")
      return {
        sql: duplicates(table, columns),
        message: "Werte kommen mehrfach vor",
      };
    return {
      sql: `SELECT (SELECT COUNT(*) FROM ${table} WHERE ${columns.map((column) => `${column} IS NULL`).join(" OR ")}) + (${duplicates(table, columns)}) FROM dual`,
      message: "leere oder doppelte Schlüsselwerte",
    };
  }
  const foreign = new RegExp(
    `^FOREIGN KEY \\(([^()]+)\\) REFERENCES (${NAME}\\.${NAME}) \\(([^()]+)\\)`,
  ).exec(body);
  if (foreign) {
    const own = identifiers(foreign[1]);
    const referenced = identifiers(foreign[3]);
    if (!own || !referenced || own.length !== referenced.length) return null;
    const present = own.map((column) => `c.${column} IS NOT NULL`).join(" AND ");
    const match = own.map((column, index) => `p.${referenced[index]} = c.${column}`).join(" AND ");
    return {
      sql: referenceExists(foreign[2])
        ? `SELECT COUNT(*) FROM ${table} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${foreign[2]} p WHERE ${match})`
        : `SELECT COUNT(*) FROM ${table} c WHERE ${present}`,
      message: "Verweis auf nicht vorhandene Datensätze",
    };
  }
  const check = /^CHECK \(([\s\S]*)\)(?:\s+DEFERRABLE(?:\s+INITIALLY DEFERRED)?)?$/.exec(body);
  if (check)
    return {
      sql: `SELECT COUNT(*) FROM ${table} WHERE NOT (${check[1]})`,
      message: "Prüfbedingung verletzt",
    };
  return null;
}

const TEXT_TYPE = /^(VARCHAR2|NVARCHAR2|CHAR|NCHAR)\((\d+)(?: (CHAR|BYTE))?\)$/;
const NUMBER_TYPE = /^NUMBER(?:\((\*|\d+)(?:,(\d+))?\))?$/;

function numberShape(type: string): { precision: number; scale: number } | null {
  const match = NUMBER_TYPE.exec(type);
  if (!match) return null;
  if (!match[1]) return { precision: Number.POSITIVE_INFINITY, scale: Number.POSITIVE_INFINITY };
  return { precision: match[1] === "*" ? 38 : Number(match[1]), scale: Number(match[2] ?? 0) };
}

export function columnChecks(
  source: CatalogObject,
  target: CatalogObject,
  table: string,
  typeChanged: boolean,
): DataCheck[] {
  const column = `"${source.name.replace(/"/g, '""')}"`;
  const checks: DataCheck[] = [];
  const wanted = source.attributes;
  const present = target.attributes;
  if (wanted.nullable === "NO" && present.nullable !== "NO")
    checks.push({
      sql: `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NULL`,
      message: "leere Werte in der Spalte",
    });
  if (!typeChanged) return checks;
  const next = TEXT_TYPE.exec(wanted.type ?? "");
  const previous = TEXT_TYPE.exec(present.type ?? "");
  if (next && previous && next[1] === previous[1]) {
    const bytes = next[3] === "BYTE";
    checks.push({
      sql: `SELECT COUNT(*) FROM ${table} WHERE ${bytes ? "LENGTHB" : "LENGTH"}(${column}) > ${next[2]}`,
      message: `länger als ${next[2]} ${bytes ? "Byte" : "Zeichen"}`,
    });
  }
  const after = numberShape(wanted.type ?? "");
  const before = numberShape(present.type ?? "");
  if (after && before && (after.precision < before.precision || after.scale < before.scale))
    checks.push({
      sql: `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL`,
      message: "Spalte enthält Werte, Oracle verringert Stellen nur bei leerer Spalte",
    });
  return checks;
}

export function addColumnCheck(column: CatalogObject, table: string): DataCheck | null {
  const attributes = column.attributes;
  if (
    attributes.nullable !== "NO" ||
    attributes.default ||
    attributes.identity ||
    attributes.virtual ||
    attributes.generated
  )
    return null;
  return {
    sql: `SELECT COUNT(*) FROM ${table}`,
    message: "Tabelle enthält Zeilen, eine NOT-NULL-Spalte ohne Default ist dann nicht möglich",
  };
}
