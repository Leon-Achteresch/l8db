import { useDeferredValue } from "react";
import { DataTableContent } from "./data-table/data-table-content";
import type { DataTableProps } from "./data-table-types";

export function DataTable(props: DataTableProps) {
  const deferred = useDeferredValue<DataTableProps | null>(props, null);
  return deferred && <DataTableContent {...deferred} />;
}
