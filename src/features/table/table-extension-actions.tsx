import { useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { Loader2Icon, PuzzleIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections";
import { countTableRows, fetchTableRows } from "@/lib/db";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";
import { readTableSnapshot } from "@/lib/extensions/table-snapshot";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableReadTransactionId, useTransactionStore } from "@/lib/transactions";

type Props = {
  connection: SavedConnection;
  database: string | null;
  schema: string;
  table: string;
  filter: string;
  filterRaw: boolean;
  sorting: SortingState;
  isView: boolean;
};

export function TableExtensionActions(source: Props) {
  const host = useExtensionHost();
  const navigate = useNavigate();
  const [running, setRunning] = useState<string | null>(null);
  const busy = useRef(false);
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.extensions.table-json-viewer");
  const actions = useExtensionSnapshot((manager) =>
    manager.commands.menusFor("table/toolbar").flatMap((menu) => {
      const extension = manager.registry.get(menu.owner);
      const command = manager.commands.list().find((item) => item.id === menu.command);
      return extension.enabled && command ? [command] : [];
    }),
  );
  if (!actions.length) return null;

  const run = async (command: string, owner: string) => {
    if (busy.current) return;
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

  return (
    <div ref={feature.ref} className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={running !== null}
          title="Alle Zeilen des aktiven Filters an diese Extension übergeben"
          onClick={() => void run(action.id, action.owner)}
        >
          {running === action.id ? <Loader2Icon className="animate-spin" /> : <PuzzleIcon />}
          {action.title}
        </Button>
      ))}
      {feature.isNew && <NewBadge />}
      <span className="text-xs text-muted-foreground">
        {running ? "JSON wird vorbereitet…" : "Alle gefilterten Zeilen"}
      </span>
    </div>
  );
}
