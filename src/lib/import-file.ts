import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
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
  return typeof path === "string" ? readImportFile(path) : null;
}
