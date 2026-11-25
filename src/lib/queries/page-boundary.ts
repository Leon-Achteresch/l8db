import type { QueryClient } from "@tanstack/react-query";
import {
  type DatabaseKind,
  type TableColumnMetadata,
  type TableData,
  type TablePageBoundary,
  tableColumnList,
} from "@/lib/db";

export const ROWS_WINDOW_STALE_MS = 30_000;

export type RowsQueryKey = readonly [
  "rows",
  connectionId: string | undefined,
  database: string | null,
  schema: string,
  table: string,
  filter: string,
  sortColumn: string,
  descending: boolean,
  view: boolean,
  page: number,
  limit: number,
  raw: boolean,
  transaction: string | undefined | null,
];

export function previousPageBoundary(
  client: QueryClient,
  key: RowsQueryKey,
  kind: DatabaseKind,
): TablePageBoundary | undefined {
  const [, connectionId, database, schema, table, filter, sortColumn, , view, page, limit, , tx] =
    key;
  if (
    (kind !== "postgres" && kind !== "oracle") ||
    page * limit < 4096 ||
    limit < 1 ||
    limit > 1000 ||
    filter ||
    view ||
    tx
  )
    return;
  if (client.getQueryData(key) !== undefined) return;
  const previousKey = [...key];
  previousKey[9] = page - 1;
  const previous = client.getQueryState<TableData>(previousKey);
  if (
    !previous?.data ||
    previous.status !== "success" ||
    previous.fetchStatus !== "idle" ||
    previous.isInvalidated ||
    Date.now() - previous.dataUpdatedAt >= ROWS_WINDOW_STALE_MS ||
    previous.data.rows.length !== limit
  )
    return;
  const metadata = client.getQueryState<TableColumnMetadata>([
    "columns-detailed",
    connectionId,
    database,
    schema,
    table,
  ]);
  if (!metadata?.data || metadata.isInvalidated) return;
  const columns = tableColumnList(metadata.data);
  const keys = columns.filter((column) => column.is_primary_key);
  if (keys.length !== 1) return;
  const pk = keys[0];
  const row = previous.data.rows[limit - 1];
  const value = row[pk.name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return;
  if (!sortColumn || sortColumn === pk.name) return { key: pk.name, value };
  const column = columns.find((c) => c.name === sortColumn);
  const sortText = row[sortColumn];
  if (
    !column ||
    column.is_nullable ||
    typeof sortText !== "string" ||
    !sortText ||
    sortText.length > 256
  )
    return;
  return { key: pk.name, value, sortText };
}
