import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedConnection } from "@/lib/connections";
import { listDatabases } from "@/lib/db/catalog";
import { useConnectionEnvironment } from "@/lib/environments";
import { type MultiTarget, multiTarget } from "@/lib/multi-target";
import { useCapabilities } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

import { MultiTargetDatabaseRow } from "./multi-target-database-row";

interface MultiTargetConnectionGroupProps {
  connection: SavedConnection;
  active: boolean;
  filter: string;
  selected: ReadonlySet<string>;
  onToggle: (targets: MultiTarget[], checked: boolean) => void;
}

async function loadDatabases(connection: SavedConnection): Promise<string[]> {
  const ready = await prepareConnection(connection.id);
  return listDatabases(ready.kind, effectiveConnectionString(ready));
}

export function MultiTargetConnectionGroup({
  connection,
  active,
  filter,
  selected,
  onToggle,
}: MultiTargetConnectionGroupProps) {
  const caps = useCapabilities(connection.kind);
  const environment = useConnectionEnvironment(connection);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(active);
  const [selectingAll, setSelectingAll] = useState(false);
  const databasesKey = ["multi-target-databases", connection.id];
  const databases = useQuery({
    queryKey: databasesKey,
    enabled: open && caps.databases,
    staleTime: 60_000,
    queryFn: () => loadDatabases(connection),
  });
  const nameMatches = !filter || connection.name.toLowerCase().includes(filter);
  const visible = (databases.data ?? []).filter(
    (database) => nameMatches || database.toLowerCase().includes(filter),
  );
  const ownTarget = multiTarget(connection.id);
  const selectAll = async () => {
    setSelectingAll(true);
    try {
      const names = await queryClient.fetchQuery({
        queryKey: databasesKey,
        staleTime: 60_000,
        queryFn: () => loadDatabases(connection),
      });
      setOpen(true);
      onToggle(
        names.map((database) => multiTarget(connection.id, database)),
        true,
      );
    } finally {
      setSelectingAll(false);
    }
  };
  if (!nameMatches && !visible.length && !open) return null;
  return (
    <li className="border-b py-1.5">
      <div className="flex items-center gap-2 text-xs">
        {caps.databases ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={open ? "Datenbanken ausblenden" : "Datenbanken anzeigen"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </Button>
        ) : (
          <Checkbox
            checked={selected.has(ownTarget.id)}
            onCheckedChange={(checked) => onToggle([ownTarget], checked === true)}
            aria-label={`${connection.name} auswählen`}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium" title={connection.name}>
          {connection.name}
        </span>
        {environment && (
          <Badge
            variant={environment.value === "production" ? "destructive" : "secondary"}
            className="text-[10px]"
          >
            {environment.label}
          </Badge>
        )}
        {connection.readOnly && (
          <Badge variant="outline" className="text-[10px]">
            Nur lesen
          </Badge>
        )}
      </div>
      {caps.databases && (
        <Button
          size="sm"
          variant="link"
          className="ml-6 h-5 px-0 text-[11px]"
          disabled={selectingAll}
          onClick={() => void selectAll()}
        >
          {selectingAll && <LoaderIcon className="size-3 animate-spin" />}
          Alle Datenbanken dieses Servers
        </Button>
      )}
      {open && caps.databases && (
        <ul>
          {databases.isLoading && (
            <li className="flex items-center gap-1.5 py-1 pl-6 text-[11px] text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" /> Datenbanken werden geladen…
            </li>
          )}
          {databases.error && (
            <li className="py-1 pl-6 text-[11px] text-destructive">{String(databases.error)}</li>
          )}
          {visible.map((database) => (
            <MultiTargetDatabaseRow
              key={database}
              connection={connection}
              database={database}
              schemasSupported={caps.multi_target_schemas}
              filter={nameMatches ? "" : filter}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
