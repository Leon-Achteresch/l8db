import { detectDelimiter, detectHeader, stripBom } from "./detect";
import {
  CSV_PREVIEW_ROWS,
  type CsvCell,
  type CsvEmptyFieldMode,
  type CsvParseError,
  type CsvParseOptions,
  type CsvParseResult,
} from "./types";

interface RawParse {
  records: CsvCell[][];
  errors: CsvParseError[];
  truncated: boolean;
}

function parseRecords(
  text: string,
  delimiter: string,
  quote: string,
  emptyField: CsvEmptyFieldMode,
  maxRecords: number,
  partial = false,
  nullText = "",
): RawParse {
  const records: CsvCell[][] = [];
  let record: CsvCell[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let started = false;
  let truncated = false;
  let blanks = 0;
  let trailing = false;
  let quoteStart = 0;
  const errors: CsvParseError[] = [];

  const pushField = () => {
    if (
      !quoted &&
      ((field === "" && emptyField === "null") || (nullText !== "" && field === nullText))
    )
      record.push(null);
    else record.push(field);
    field = "";
    quoted = false;
    trailing = false;
  };

  const pushRecord = () => {
    const isBlank = record.length === 0 && !started && !quoted && field === "";
    pushField();
    if (isBlank) {
      blanks += 1;
      records.push([]);
    } else records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    if (records.length - blanks >= maxRecords) {
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
      quoteStart = i;
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
    if (quoted && !trailing && char.trim() !== "") {
      trailing = true;
      if (errors.length < 10) {
        const preceding = text.slice(0, i).split(/\r\n|\r|\n/);
        const line = preceding.length;
        const column = (preceding.at(-1)?.length ?? 0) + 1;
        errors.push({
          line,
          column,
          message: `Zeichen nach schließendem Anführungszeichen in Zeile ${line}, Spalte ${column}.`,
        });
      }
    }
    field += char;
    started = true;
  }

  if (!truncated && !partial && inQuotes) {
    const preceding = text.slice(0, quoteStart).split(/\r\n|\r|\n/);
    const line = preceding.length;
    const column = (preceding.at(-1)?.length ?? 0) + 1;
    errors.push({
      line,
      column,
      message: `Nicht geschlossenes Anführungszeichen in Zeile ${line}, Spalte ${column}.`,
    });
  }

  if (
    !truncated &&
    !partial &&
    !inQuotes &&
    (started || field !== "" || record.length > 0 || quoted)
  ) {
    pushRecord();
  }

  return { records, truncated: truncated || partial, errors };
}

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const quote = options.quote ?? '"';
  const emptyField = options.emptyField ?? "null";
  const content = stripBom(text);
  const delimiter = options.delimiter ?? detectDelimiter(content, quote);
  const maxRows = options.maxRows ?? Number.MAX_SAFE_INTEGER;
  const limit = maxRows === Number.MAX_SAFE_INTEGER ? maxRows : maxRows + 1;

  const parsed = parseRecords(
    content,
    delimiter,
    quote,
    emptyField,
    limit,
    options.partial,
    options.nullText,
  );
  const { truncated, errors } = parsed;
  const filled = parsed.records.filter((record) => record.length > 0);
  const records = filled.every((record) => record.length === 1)
    ? parsed.records.map((record) =>
        record.length > 0 ? record : [emptyField === "null" ? null : ""],
      )
    : filled;
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
    errors,
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
