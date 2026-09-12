import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { DataTable } from "@/features/table/data-table";
import { useActiveConnection } from "@/lib/connections";
import { executeQueryWithParams } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { bindMasterDetail, masterDetailScriptError, useMasterDetail } from "@/lib/master-detail";
import { effectiveConnectionString } from "@/lib/ssh";

export function MasterDetailResult({ source, sql }: { source: string; sql: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const selection = useMasterDetail((state) => state.selections[source]);
  const [settledSelection, setSettledSelection] = useState(selection);
  useEffect(() => {
    const timer = setTimeout(() => setSettledSelection(selection), 150);
    return () => clearTimeout(timer);
  }, [selection]);
  const validation = masterDetailScriptError(sql);
  const supported = capabilities.query_language === "sql" && capabilities.bind_parameters;
  const result = useQuery({
    queryKey: [
      "master-detail",
      connection?.id,
      database,
      source,
      sql,
      settledSelection?.column,
      settledSelection?.value,
    ],
    queryFn: async () => {
      if (!connection || !settledSelection || validation || !supported)
        throw new Error("Keine gültige Master-Detail-Verknüpfung.");
      const bound = bindMasterDetail(sql, settledSelection.value);
      return executeQueryWithParams(
        connection.kind,
        effectiveConnectionString(connection),
        bound.sql,
        bound.params,
        database ?? undefined,
      );
    },
    enabled: Boolean(
      connection && settledSelection && !validation && supported && selection === settledSelection,
    ),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  if (!supported)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Diese Verbindung unterstützt keine SQL-Bind-Parameter für Master-Detail.
      </p>
    );
  if (validation)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {validation}
      </p>
    );
  if (!selection)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Wähle eine Zelle im Master, um die Details zu laden.
      </p>
    );
  if (selection !== settledSelection || result.isPending)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Details werden geladen…
      </p>
    );
  if (result.error)
    return (
      <p role="alert" className="overflow-auto p-4 text-sm text-destructive">
        {String(result.error)}
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground">
        Master: {selection.column} · {result.data?.rows.length ?? 0} Zeilen
      </div>
      <DataTable
        columns={result.data?.columns ?? []}
        data={result.data?.rows ?? []}
        emptyMessage="Keine passenden Details."
        sorting={[]}
        sortableColumns={[]}
        onSortingChange={() => {}}
        isFetching={result.isFetching}
        onRefresh={() => {
          void result.refetch();
        }}
      />
    </div>
  );
}
