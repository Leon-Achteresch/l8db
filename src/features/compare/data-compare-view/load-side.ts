import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { LoadedSide } from "@/features/compare/data-compare-view/types";
import type { SavedConnection } from "@/lib/connections";
import { listConstraints, listTableColumnsDetailed } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export async function loadSide(
  connection: SavedConnection,
  side: DataCompareSideSelection,
): Promise<LoadedSide> {
  if (!capabilitiesFor(connection.kind).data_compare)
    throw new Error("Diese Verbindung unterstützt keinen Datenvergleich.");
  const url = effectiveConnectionString(connection);
  const database = side.database ?? undefined;
  const schema = side.schema as string;
  const table = side.table as string;
  const [detailed, constraints] = await Promise.all([
    listTableColumnsDetailed(connection.kind, url, schema, table, database),
    listConstraints(connection.kind, url, schema, table, database),
  ]);
  const primary = constraints.find((item) => item.constraint_type === "PRIMARY KEY");
  const keyColumns =
    primary && primary.columns.length > 0
      ? primary.columns
      : detailed.filter((column) => column.is_primary_key).map((column) => column.name);
  return {
    columns: detailed.map((column) => ({ name: column.name, data_type: column.data_type })),
    keyColumns: side.keyColumns?.length ? side.keyColumns : keyColumns,
  };
}
