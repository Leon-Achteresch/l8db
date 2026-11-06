import { type ReactNode, useMemo, useState } from "react";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import { compareWatchedRows, type RowWatch } from "@/lib/workbench/row-watches";
import { useWorkbenchRecords } from "@/lib/workbench/use-records";
import { RowWatches } from "./row-watches";

export function RowWatchProvider({
  scope,
  rows,
  children,
}: {
  scope?: string;
  rows: Record<string, unknown>[];
  children: ReactNode;
}) {
  const [openScope, setOpenScope] = useState<string | null>(null);
  const { records, loading, error } = useWorkbenchRecords<RowWatch>(
    "watch",
    scope ?? "",
    Boolean(scope),
  );
  const states = useMemo(() => compareWatchedRows(records, rows), [records, rows]);
  const value = useMemo(() => {
    return {
      scope: scope ?? "",
      open: Boolean(scope && openScope === scope),
      setOpen: (open: boolean) => setOpenScope(open ? (scope ?? null) : null),
      records,
      states,
      changedRows: new Set(
        states.filter((state) => state.changed.length > 0).map((state) => state.row),
      ),
      loading,
      error,
    };
  }, [scope, openScope, records, states, loading, error]);
  return (
    <RowWatchContext.Provider value={value}>
      {children}
      {scope && <RowWatches key={scope} scope={scope} />}
    </RowWatchContext.Provider>
  );
}
