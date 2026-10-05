import type { TableData } from "@/lib/db";
import { gridCellText } from "@/lib/grid-search";
import { ExtensionError, type TableSnapshot } from "./contracts";

export const TABLE_SNAPSHOT_ROW_LIMIT = 50_000;
const TABLE_SNAPSHOT_SIZE_LIMIT = 4 * 1024 * 1024;

export async function readTableSnapshot(
  source: Omit<TableSnapshot, "columns" | "rows">,
  reader: { count(): Promise<number>; fetch(limit: number): Promise<TableData> },
): Promise<TableSnapshot> {
  const count = await reader.count();
  if (!Number.isSafeInteger(count) || count < 0 || count > TABLE_SNAPSHOT_ROW_LIMIT)
    throw new ExtensionError(
      "TableSnapshotError",
      "Bitte den Filter auf höchstens 50.000 Zeilen eingrenzen.",
    );
  const data = await reader.fetch(count + 1);
  if (data.rows.length !== count)
    throw new ExtensionError(
      "TableSnapshotError",
      "Die Tabelle wurde verändert oder unvollständig geladen. Bitte erneut versuchen.",
    );
  const columns = data.columns.filter((column) => column !== "__ctid__");
  const snapshot: TableSnapshot = {
    ...source,
    columns,
    rows: data.rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column, row[column] == null ? null : gridCellText(row[column])]),
      ),
    ),
  };
  if (JSON.stringify(snapshot).length > TABLE_SNAPSHOT_SIZE_LIMIT)
    throw new ExtensionError(
      "TableSnapshotError",
      "Die Daten sind zu groß. Bitte Filter eingrenzen.",
    );
  return snapshot;
}
