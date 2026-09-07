export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CSV_PREVIEW_ROWS = 100;
export const CSV_MAX_IMPORT_ROWS = 10_000;

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;

export type CsvCell = string | null;

export type CsvEmptyFieldMode = "null" | "empty";

export interface CsvParseOptions {
  delimiter?: string;
  quote?: string;
  hasHeader?: boolean;
  maxRows?: number;
  emptyField?: CsvEmptyFieldMode;
}

export interface CsvParseResult {
  delimiter: string;
  quote: string;
  hasHeader: boolean;
  headers: string[];
  rows: CsvCell[][];
  columnCount: number;
  totalRows: number | null;
  truncated: boolean;
  raggedRows: number[];
}

export interface ImportTargetColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  has_default: boolean;
  is_identity: boolean;
  is_generated: boolean;
}

export interface CsvColumnMapping {
  csvIndex: number;
  target: string | null;
}

export interface CsvMappingIssues {
  errors: string[];
  warnings: string[];
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string, quote: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === quote) {
      if (inQuotes && line[i + 1] === quote) {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

function sampleLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && lines.length < limit; i += 1) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (current.length > 0) lines.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0 && lines.length < limit) lines.push(current);
  return lines;
}

export function detectDelimiter(text: string, quote = '"'): string {
  const lines = sampleLines(stripBom(text), 10);
  if (lines.length === 0) return ",";
  let best = ",";
  let bestScore = -1;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter, quote));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = first * 100 + consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function looksNumeric(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return /^[+-]?\d+([.,]\d+)?$/.test(trimmed);
}

export function detectHeader(records: CsvCell[][]): boolean {
  const first = records[0];
  if (!first || first.length === 0) return false;
  const cells = first.map((c) => c ?? "");
  if (cells.some((c) => c.trim() === "")) return false;
  if (cells.some(looksNumeric)) return false;
  const unique = new Set(cells.map((c) => c.trim().toLowerCase()));
  if (unique.size !== cells.length) return false;
  return true;
}

interface RawParse {
  records: CsvCell[][];
  truncated: boolean;
}

function parseRecords(
  text: string,
  delimiter: string,
  quote: string,
  emptyField: CsvEmptyFieldMode,
  maxRecords: number,
): RawParse {
  const records: CsvCell[][] = [];
  let record: CsvCell[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let started = false;
  let truncated = false;

  const pushField = () => {
    if (!quoted && field === "" && emptyField === "null") record.push(null);
    else record.push(field);
    field = "";
    quoted = false;
  };

  const pushRecord = () => {
    pushField();
    const isBlank = record.length === 1 && (record[0] === null || record[0] === "");
    if (!isBlank) records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    if (records.length >= maxRecords) {
      truncated = true;
      break;
    }
    const char = text[i];
    if (inQuotes) {
      if (char === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }
    if (char === quote && !started) {
      inQuotes = true;
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      pushField();
      started = false;
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRecord();
      continue;
    }
    if (char === "\n") {
      pushRecord();
      continue;
    }
    field += char;
    started = true;
  }

  if (!truncated && (started || field !== "" || record.length > 0 || quoted)) {
    pushRecord();
  }

  return { records, truncated };
}

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const quote = options.quote ?? '"';
  const emptyField = options.emptyField ?? "null";
  const content = stripBom(text);
  const delimiter = options.delimiter ?? detectDelimiter(content, quote);
  const maxRows = options.maxRows ?? Number.MAX_SAFE_INTEGER;
  const limit = maxRows === Number.MAX_SAFE_INTEGER ? maxRows : maxRows + 1;

  const { records, truncated } = parseRecords(content, delimiter, quote, emptyField, limit);
  const hasHeader = options.hasHeader ?? detectHeader(records);

  const headerRecord = hasHeader ? (records[0] ?? []) : [];
  const dataRecords = hasHeader ? records.slice(1) : records;
  const overLimit = truncated || dataRecords.length > maxRows;
  const rows = overLimit ? dataRecords.slice(0, maxRows) : dataRecords;

  const columnCount = Math.max(
    headerRecord.length,
    rows.reduce((max, row) => Math.max(max, row.length), 0),
  );

  const headers = hasHeader
    ? Array.from({ length: columnCount }, (_, i) => {
        const raw = headerRecord[i];
        const name = raw === null || raw === undefined ? "" : raw.trim();
        return name === "" ? `Spalte ${i + 1}` : name;
      })
    : Array.from({ length: columnCount }, (_, i) => `Spalte ${i + 1}`);

  const raggedRows: number[] = [];
  rows.forEach((row, index) => {
    if (row.length !== columnCount) raggedRows.push(index);
  });

  return {
    delimiter,
    quote,
    hasHeader,
    headers,
    rows,
    columnCount,
    totalRows: overLimit ? null : rows.length,
    truncated: overLimit,
    raggedRows,
  };
}

export function previewCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  return parseCsv(text, { ...options, maxRows: options.maxRows ?? CSV_PREVIEW_ROWS });
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-.]/g, "")
    .trim();
}

export function isRequiredColumn(column: ImportTargetColumn): boolean {
  return !column.is_nullable && !column.has_default && !column.is_identity && !column.is_generated;
}

export function suggestMappings(
  headers: string[],
  targets: ImportTargetColumn[],
): CsvColumnMapping[] {
  const used = new Set<string>();
  return headers.map((header, csvIndex) => {
    const normalized = normalizeName(header);
    const match = targets.find(
      (t) => !t.is_generated && !used.has(t.name) && normalizeName(t.name) === normalized,
    );
    if (match) {
      used.add(match.name);
      return { csvIndex, target: match.name };
    }
    return { csvIndex, target: null };
  });
}

export function validateMappings(
  mappings: CsvColumnMapping[],
  targets: ImportTargetColumn[],
  rows: CsvCell[][],
): CsvMappingIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byName = new Map(targets.map((t) => [t.name, t]));

  const seen = new Map<string, number>();
  for (const mapping of mappings) {
    if (!mapping.target) continue;
    if (!byName.has(mapping.target)) {
      errors.push(`Unbekannte Zielspalte "${mapping.target}".`);
      continue;
    }
    seen.set(mapping.target, (seen.get(mapping.target) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) errors.push(`Zielspalte "${name}" ist mehrfach zugeordnet.`);
  }

  const mapped = new Set(seen.keys());
  if (mapped.size === 0) errors.push("Keine Spalte zugeordnet.");

  for (const target of targets) {
    if (mapped.has(target.name) && target.is_generated) {
      errors.push(`Generierte Spalte "${target.name}" kann nicht befüllt werden.`);
    }
    if (mapped.has(target.name) && target.is_identity) {
      warnings.push(`Identity-Spalte "${target.name}" wird mit CSV-Werten überschrieben.`);
    }
    if (!mapped.has(target.name) && isRequiredColumn(target)) {
      errors.push(`Pflichtspalte "${target.name}" ist nicht zugeordnet.`);
    }
    if (!mapped.has(target.name) && target.has_default && !target.is_identity) {
      warnings.push(`Spalte "${target.name}" verwendet den Default-Wert.`);
    }
  }

  for (const mapping of mappings) {
    const target = mapping.target ? byName.get(mapping.target) : undefined;
    if (!target || target.is_nullable) continue;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const value = rows[rowIndex]?.[mapping.csvIndex] ?? null;
      if (value === null) {
        errors.push(`Zeile ${rowIndex + 1}: Spalte "${target.name}" darf nicht NULL sein.`);
        break;
      }
    }
  }

  return { errors, warnings };
}

export interface CsvImportPayload {
  columns: string[];
  rows: CsvCell[][];
}

export function buildImportPayload(
  mappings: CsvColumnMapping[],
  rows: CsvCell[][],
): CsvImportPayload {
  const active = mappings.filter((m) => m.target !== null);
  return {
    columns: active.map((m) => m.target as string),
    rows: rows.map((row) => active.map((m) => row[m.csvIndex] ?? null)),
  };
}
