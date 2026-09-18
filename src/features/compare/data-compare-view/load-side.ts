import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { LoadedSide } from "@/features/compare/data-compare-view/types";
import type { SavedConnection } from "@/lib/connections";
import { DATA_COMPARE_MAX_ROWS } from "@/lib/data-compare";
import { fetchTableRows, listConstraints, listTableColumnsDetailed } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";

export async function loadSide(
  connection: SavedConnection,
  side: DataCompareSideSelection,
): Promise<LoadedSide> {
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
  const data = await fetchTableRows(
    connection.kind,
    url,
    schema,
    table,
    undefined,
    DATA_COMPARE_MAX_ROWS + 1,
    0,
    database,
  );
  if (data.rows.length > DATA_COMPARE_MAX_ROWS)
    throw new Error(
      `Tabelle ${schema}.${table} überschreitet das Limit von ${DATA_COMPARE_MAX_ROWS} Zeilen je Seite.`,
    );
  return {
    columns: detailed.map((column) => ({ name: column.name, data_type: column.data_type })),
    keyColumns,
    rows: data.rows,
    capturedAt: new Date().toLocaleString(),
  };
}
