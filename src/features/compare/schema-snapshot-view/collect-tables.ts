import type { SavedConnection } from "@/lib/connections";
import { listTableColumnsDetailed } from "@/lib/db";
import { buildSnapshotTable, type SnapshotTable } from "@/lib/schema-snapshot";
import { effectiveConnectionString } from "@/lib/ssh";

export const JSON_FILTERS = [{ name: "Snapshot", extensions: ["json"] }];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectTables(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  tables: string[],
): Promise<SnapshotTable[]> {
  const url = effectiveConnectionString(connection);
  const collected: SnapshotTable[] = [];
  for (const table of tables) {
    try {
      const columns = await listTableColumnsDetailed(
        connection.kind,
        url,
        schema,
        table,
        database ?? undefined,
      );
      collected.push(buildSnapshotTable(schema, table, columns));
    } catch (error) {
      collected.push(buildSnapshotTable(schema, table, [], errorMessage(error)));
    }
  }
  return collected;
}
