import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { type ImportFormat, readCsvPreview } from "@/lib/db";
import { MAX_SQL_FILE_BYTES, sqlFileTitle } from "@/lib/sql-file";

export async function readImportFile(path: string, maxBytes = MAX_SQL_FILE_BYTES) {
  const meta = await stat(path);
  if (meta.size > maxBytes)
    throw new Error(`Datei ist zu groß. Maximal ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const text = await readTextFile(path);
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("Datei überschreitet die maximale Importgröße.");
  return { path, name: sqlFileTitle(path), text };
}

export async function readCsvImportFile(path: string) {
  const preview = await readCsvPreview(path);
  return { path, name: sqlFileTitle(path), ...preview };
}

export async function pickImportFile(kind: "sql" | "csv" | "json") {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: kind.toUpperCase(),
        extensions:
          kind === "sql" ? ["sql", "txt"] : kind === "json" ? ["json"] : ["csv", "tsv", "txt"],
      },
    ],
  });
  return typeof path === "string"
    ? kind === "csv"
      ? readCsvImportFile(path)
      : readImportFile(path)
    : null;
}

export const IMPORT_FILE_EXTENSIONS: Record<ImportFormat, string[]> = {
  csv: ["csv", "tsv", "txt"],
  json: ["json"],
  ndjson: ["ndjson", "jsonl"],
  xlsx: ["xlsx", "xlsm", "xls", "ods"],
  parquet: ["parquet"],
};

export function detectImportFormat(path: string): ImportFormat {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const match = (Object.keys(IMPORT_FILE_EXTENSIONS) as ImportFormat[]).find((format) =>
    IMPORT_FILE_EXTENSIONS[format].includes(extension),
  );
  return match ?? "csv";
}

export async function pickDataFile(): Promise<{
  path: string;
  name: string;
  format: ImportFormat;
} | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Daten (CSV, JSON, NDJSON, Excel, Parquet)",
        extensions: Object.values(IMPORT_FILE_EXTENSIONS).flat(),
      },
    ],
  });
  if (typeof path !== "string") return null;
  return { path, name: sqlFileTitle(path), format: detectImportFormat(path) };
}
