import { ImportIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useConnectionsStore } from "@/lib/connections";
import { transferableFilters, useViewsStore } from "@/lib/views";

interface TableFilterImportMenuProps {
  connectionId: string;
  table: string;
  tableKey: string;
}

export function TableFilterImportMenu({
  connectionId,
  table,
  tableKey,
}: TableFilterImportMenuProps) {
  const titleId = useId();
  const descriptionId = useId();
  const views = useViewsStore((state) => state.views);
  const addView = useViewsStore((state) => state.addView);
  const connections = useConnectionsStore((state) => state.connections);
  const candidates = useMemo(
    () => transferableFilters(views, connectionId, table),
    [views, connectionId, table],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          title="Filter übernehmen"
          aria-label="Filter übernehmen"
        >
          <ImportIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 max-w-[calc(100vw-2rem)] gap-3 p-3"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <PopoverHeader>
          <PopoverTitle id={titleId}>Filter übernehmen</PopoverTitle>
          <PopoverDescription id={descriptionId}>
            Gespeicherte Filter anderer Connections für „{table}“ als eigene Kopie übernehmen.
          </PopoverDescription>
        </PopoverHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              Keine gespeicherten Filter für diesen Tabellennamen in anderen Connections vorhanden.
            </p>
          )}
          {candidates.map(({ key, sourceConnectionId, database, schema, view }) => {
            const source = connections.find((connection) => connection.id === sourceConnectionId);
            const imported = (views[tableKey] ?? []).some(
              (saved) =>
                saved.name === view.name &&
                saved.filter === view.filter &&
                (saved.filterRaw ?? false) === (view.filterRaw ?? false),
            );
            return (
              <button
                type="button"
                key={`${key}:${view.id}`}
                disabled={imported}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  addView(tableKey, {
                    name: view.name,
                    filter: view.filter,
                    filterRaw: view.filterRaw,
                    color: view.color,
                  });
                  toast(`Filter „${view.name}“ übernommen`);
                }}
              >
                <span>
                  {view.name}
                  {imported ? " · Bereits vorhanden" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[source?.name ?? "Entfernte Connection", database, schema]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
                <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
                  {view.filter}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
