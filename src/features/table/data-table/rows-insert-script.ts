import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { buildInsertStatements, type InsertExportInput, UnsupportedValueError } from "@/lib/export";

function rowsLabel(count: number) {
  return count === 1 ? "1 Zeile" : `${count} Zeilen`;
}

function buildScript(input: InsertExportInput): string | null {
  try {
    return buildInsertStatements(input);
  } catch (error) {
    toast.error(
      error instanceof UnsupportedValueError
        ? `INSERT-SQL nicht möglich – ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return null;
  }
}

export function copyRowsAsInsert(input: InsertExportInput) {
  const script = buildScript(input);
  if (script === null) return;
  void copyText(script, `${rowsLabel(input.rows.length)} als INSERT-SQL kopiert.`);
}

export async function saveRowsAsInsert(input: InsertExportInput) {
  const script = buildScript(input);
  if (script === null) return;
  try {
    const filePath = await save({
      defaultPath: `${input.table}.sql`,
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, script);
    toast.success(
      `${rowsLabel(input.rows.length)} exportiert nach ${filePath.split(/[\\/]/).pop()}`,
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
