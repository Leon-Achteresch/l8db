import { useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections";
import { countTableRows, fetchTableRows } from "@/lib/db";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";
import { readTableSnapshot } from "@/lib/extensions/table-snapshot";
import { useHasNewFeatures } from "@/lib/new-features";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableReadTransactionId, useTransactionStore } from "@/lib/transactions";

type Source = {
  connection: SavedConnection | null | undefined;
  database: string | null;
  schema: string;
  table: string;
  filter: string;
  filterRaw: boolean;
  sorting: SortingState;
  isView: boolean;
};

export function useTableExtensionActions(source: Source, enabled: boolean) {
  const host = useExtensionHost();
  const navigate = useNavigate();
  const [running, setRunning] = useState<string | null>(null);
  const busy = useRef(false);
  const isNew = useHasNewFeatures("table.extensions.table-json-viewer");
  const actions = useExtensionSnapshot((manager) =>
    !enabled || !source.connection
      ? []
      : manager.commands.menusFor("table/toolbar").flatMap((menu) => {
          const extension = manager.registry.get(menu.owner);
          const command = manager.commands.list().find((item) => item.id === menu.command);
          return extension.enabled && command ? [command] : [];
        }),
  );

  const run = async (command: string, owner: string) => {
    if (busy.current || !source.connection) return;
    busy.current = true;
    setRunning(command);
    const previous = new Map(host.listPanels().map((panel) => [panel.panelId, panel.updatedAt]));
    const activeId = useConnectionsStore.getState().activeId;
    try {
      const { connection, database, schema, table, filter, filterRaw, sorting, isView } = source;
      const connectionString = effectiveConnectionString(connection);
      const txId = tableReadTransactionId(
        useTransactionStore.getState().transactions,
        connection.id,
        database,
        schema,
        table,
      );
      await host.executeTableCommand(command, () =>
        readTableSnapshot(
          { connectionId: connection.id, database, schema, table, filter },
          {
            count: () =>
              countTableRows(
                connection.kind,
                connectionString,
                schema,
                table,
                filter,
                database ?? undefined,
                filterRaw,
                txId,
              ),
            fetch: (limit) =>
              fetchTableRows(
                connection.kind,
                connectionString,
                schema,
                table,
                filter,
                limit,
                0,
                database ?? undefined,
                sorting[0] ? { column: sorting[0].id, desc: sorting[0].desc } : undefined,
                isView,
                filterRaw,
                txId,
              ),
          },
        ),
      );
      const panel = host
        .listPanels()
        .find(
          (item) => item.extensionId === owner && previous.get(item.panelId) !== item.updatedAt,
        );
      if (panel && useConnectionsStore.getState().activeId === activeId)
        await navigate({
          to: "/extension-panels/$extensionId/$panelId",
          params: { extensionId: panel.extensionId, panelId: panel.panelId },
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      setRunning(null);
    }
  };

  return {
    actions,
    running,
    run,
    isNew: isNew && actions.some((action) => action.id === "tablejson.show"),
  };
}
