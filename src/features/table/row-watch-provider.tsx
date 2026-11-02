import { type ReactNode, useMemo } from "react";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import { compareWatchedRows, type RowWatch } from "@/lib/workbench/row-watches";
import { useWorkbenchRecords } from "@/lib/workbench/use-records";

export function RowWatchProvider({
  scope,
  rows,
  children,
}: {
  scope?: string;
  rows: Record<string, unknown>[];
  children: ReactNode;
}) {
  const { records, loading, error } = useWorkbenchRecords<RowWatch>(
    "watch",
    scope ?? "",
    Boolean(scope),
  );
  const value = useMemo(() => {
    const states = compareWatchedRows(records, rows);
    return {
      scope: scope ?? "",
      records,
      states,
      changedRows: new Set(
        states.filter((state) => state.changed.length > 0).map((state) => state.row),
      ),
      loading,
      error,
    };
  }, [scope, records, rows, loading, error]);
  return <RowWatchContext.Provider value={value}>{children}</RowWatchContext.Provider>;
}
