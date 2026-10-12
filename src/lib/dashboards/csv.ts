import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { DEFAULT_CSV_OPTIONS, serializeCsv } from "@/lib/export";

export function csvFileName(title: string): string {
  return `${title.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "daten"}.csv`;
}

export function rowsCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return serializeCsv(columns, rows, { ...DEFAULT_CSV_OPTIONS, bom: true });
}

export async function exportRowsCsv(
  title: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<boolean> {
  const path = await save({
    defaultPath: csvFileName(title),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await writeTextFile(path, rowsCsv(columns, rows));
  return true;
}
