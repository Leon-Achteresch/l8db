import type { DatabaseKind } from "@/lib/db";
import { type ColumnMask, maskValue } from "@/lib/masking";

export type CsvLineEnding = "\n" | "\r\n";

export interface CsvOptions {
  delimiter: string;
  quote: string;
  header: boolean;
  nullText: string;
  lineEnding: CsvLineEnding;
  bom: boolean;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  quote: '"',
  header: true,
  nullText: "",
  lineEnding: "\n",
  bom: false,
};

export const CSV_DELIMITERS = [
  { value: ",", label: "Komma (,)" },
  { value: ";", label: "Semikolon (;)" },
  { value: "\t", label: "Tabulator" },
  { value: "|", label: "Pipe (|)" },
] as const;

export const CSV_QUOTES = [
  { value: '"', label: 'Doppelt (")' },
  { value: "'", label: "Einfach (')" },
] as const;

export function csvOptionsError(options: CsvOptions): string | null {
  if (options.delimiter.length !== 1) return "Trennzeichen muss genau ein Zeichen sein.";
  if (options.quote.length !== 1) return "Quote-Zeichen muss genau ein Zeichen sein.";
  if (options.delimiter === options.quote)
    return "Trennzeichen und Quote-Zeichen müssen sich unterscheiden.";
  if (options.delimiter === "\r" || options.delimiter === "\n")
    return "Trennzeichen darf kein Zeilenumbruch sein.";
  return null;
}

export function csvValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function csvField(value: unknown, options: CsvOptions): string {
  const text = csvValueText(value) ?? options.nullText;
  const needsQuote =
    text.includes(options.delimiter) ||
    text.includes(options.quote) ||
    text.includes("\n") ||
    text.includes("\r") ||
    text !== text.trim();
  if (!needsQuote) return text;
  const escaped = text.split(options.quote).join(options.quote + options.quote);
  return `${options.quote}${escaped}${options.quote}`;
}

export function serializeCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  options: CsvOptions,
): string {
  const lines: string[] = [];
  if (options.header) {
    lines.push(columns.map((c) => csvField(c, options)).join(options.delimiter));
  }
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c], options)).join(options.delimiter));
  }
  const body = lines.join(options.lineEnding);
  return options.bom ? `\uFEFF${body}` : body;
}

export function csvPreview(
  columns: string[],
  rows: Record<string, unknown>[],
  options: CsvOptions,
  limit = 5,
): string {
  return serializeCsv(columns, rows.slice(0, limit), { ...options, bom: false });
}

export type { ColumnMask, MaskMode } from "@/lib/masking";
export { applyMasks, DEFAULT_MASK_TEXT } from "@/lib/masking";

export function maskedValue(column: string, value: unknown, masks: ColumnMask[]): unknown {
  const mask = masks.find((entry) => entry.column === column);
  return mask ? maskValue(column, value, mask) : value;
}

export function parseCsv(text: string, options: CsvOptions): string[][] {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === options.quote) {
        if (input[i + 1] === options.quote) {
          field += options.quote;
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === options.quote && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === options.delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r" && input[i + 1] === "\n") {
      pushRow();
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  pushRow();
  return rows;
}

export type SqlIdentifierStyle = "double" | "backtick" | "bracket";

export function identifierStyleForKind(kind: DatabaseKind | null | undefined): SqlIdentifierStyle {
  if (kind === "mysql") return "backtick";
  if (kind === "mssql") return "bracket";
  return "double";
}

export function quoteIdentifier(name: string, style: SqlIdentifierStyle): string {
  if (style === "backtick") return `\`${name.split("`").join("``")}\``;
  if (style === "bracket") return `[${name.split("]").join("]]")}]`;
  return `"${name.split('"').join('""')}"`;
}

export class UnsupportedValueError extends Error {
  readonly column: string;

  constructor(column: string, detail: string) {
    super(`Spalte "${column}": ${detail}`);
    this.name = "UnsupportedValueError";
    this.column = column;
  }
}

function quoteSqlString(text: string): string {
  return `'${text.split("'").join("''")}'`;
}

export function sqlLiteral(value: unknown, column: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new UnsupportedValueError(column, "Zahl ist nicht endlich (NaN/Infinity).");
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\u0000"))
      throw new UnsupportedValueError(column, "Text enthält ein Nullbyte.");
    return quoteSqlString(value);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new UnsupportedValueError(column, "Ungültiges Datum.");
    return quoteSqlString(value.toISOString());
  }
  if (typeof value === "object") {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
      throw new UnsupportedValueError(column, "Binärdaten werden nicht unterstützt.");
    try {
      return quoteSqlString(JSON.stringify(value));
    } catch {
      throw new UnsupportedValueError(column, "Wert lässt sich nicht als JSON abbilden.");
    }
  }
  throw new UnsupportedValueError(column, `Typ ${typeof value} wird nicht unterstützt.`);
}

export interface InsertExportInput {
  schema?: string | null;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  kind?: DatabaseKind | null;
  lineEnding?: CsvLineEnding;
}

export function qualifiedTarget(
  schema: string | null | undefined,
  table: string,
  style: SqlIdentifierStyle,
): string {
  const name = quoteIdentifier(table, style);
  return schema ? `${quoteIdentifier(schema, style)}.${name}` : name;
}

export function buildInsertStatements(input: InsertExportInput): string {
  const style = identifierStyleForKind(input.kind);
  const columns = input.columns.filter((c) => c !== "__ctid__");
  if (columns.length === 0) throw new Error("Keine Spalten für den Export vorhanden.");
  const target = qualifiedTarget(input.schema, input.table, style);
  const columnList = columns.map((c) => quoteIdentifier(c, style)).join(", ");
  const eol = input.lineEnding ?? "\n";
  const statements = input.rows.map((row) => {
    const values = columns.map((c) => sqlLiteral(row[c], c)).join(", ");
    return `INSERT INTO ${target} (${columnList}) VALUES (${values});`;
  });
  return statements.length === 0 ? "" : `${statements.join(eol)}${eol}`;
}

export const COPY_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV" },
  { value: "tsv", label: "TSV" },
  { value: "markdown", label: "Markdown" },
] as const;

export type CopyFormat = (typeof COPY_FORMATS)[number]["value"];

export function serializeRows(
  columns: string[],
  rows: Record<string, unknown>[],
  format: CopyFormat,
): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "csv") return serializeCsv(columns, rows, DEFAULT_CSV_OPTIONS);
  if (format === "tsv")
    return serializeCsv(columns, rows, { ...DEFAULT_CSV_OPTIONS, delimiter: "\t" });
  const cell = (value: unknown) =>
    (csvValueText(value) ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `| ${columns.map(cell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((c) => cell(row[c])).join(" | ")} |`),
  ].join("\n");
}
