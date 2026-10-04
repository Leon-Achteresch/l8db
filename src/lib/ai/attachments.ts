import { inferColumnTypes, parseCsv } from "@/lib/csv-import";
import type { AiAttachment } from "@/lib/db/ai";
import { readImportPreview } from "@/lib/db/columns";
import { detectImportFormat, IMPORT_FILE_EXTENSIONS, readCsvImportFile } from "@/lib/import-file";
import { sqlFileTitle } from "@/lib/sql-file";

const SAMPLE_ROWS = 20;
const ATTACHABLE = new Set(Object.values(IMPORT_FILE_EXTENSIONS).flat());

export function aiAttachable(path: string): boolean {
  return ATTACHABLE.has(path.split(".").pop()?.toLowerCase() ?? "");
}

export async function aiAttachment(path: string): Promise<AiAttachment> {
  const name = sqlFileTitle(path);
  const format = detectImportFormat(path);
  if (format === "csv") {
    const file = await readCsvImportFile(path);
    const parsed = parseCsv(file.text, { maxRows: file.partial ? 5000 : undefined });
    return {
      name,
      path,
      format,
      delimiter: parsed.delimiter,
      quote: parsed.quote,
      hasHeader: parsed.hasHeader,
      sheet: null,
      columns: parsed.headers,
      types: inferColumnTypes(parsed.columnCount, parsed.rows),
      rows: parsed.rows.slice(0, SAMPLE_ROWS),
      totalRows: file.partial ? null : parsed.rows.length,
    };
  }
  const preview = await readImportPreview(path, format);
  return {
    name,
    path,
    format,
    delimiter: "",
    quote: "",
    hasHeader: true,
    sheet: preview.sheet,
    columns: preview.columns,
    types: inferColumnTypes(preview.columns.length, preview.rows),
    rows: preview.rows.slice(0, SAMPLE_ROWS),
    totalRows: preview.total_rows,
  };
}
