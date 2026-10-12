import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedConnection } from "@/lib/connections";
import { listSchemas } from "@/lib/db/catalog";
import { type MultiTarget, multiTarget } from "@/lib/multi-target";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

interface MultiTargetDatabaseRowProps {
  connection: SavedConnection;
  database: string;
  schemasSupported: boolean;
  filter: string;
  selected: ReadonlySet<string>;
  onToggle: (targets: MultiTarget[], checked: boolean) => void;
}

export function MultiTargetDatabaseRow({
  connection,
  database,
  schemasSupported,
  filter,
  selected,
  onToggle,
}: MultiTargetDatabaseRowProps) {
  const [open, setOpen] = useState(false);
  const schemas = useQuery({
    queryKey: ["multi-target-schemas", connection.id, database],
    enabled: open && schemasSupported,
    staleTime: 60_000,
    queryFn: async () => {
      const ready = await prepareConnection(connection.id);
      return listSchemas(ready.kind, effectiveConnectionString(ready), database);
    },
  });
  const target = multiTarget(connection.id, database);
  const visibleSchemas = (schemas.data ?? []).filter(
    (schema) => !filter || schema.toLowerCase().includes(filter),
  );
  return (
    <li>
      <div className="flex items-center gap-2 py-0.5 pl-6 text-xs">
        <Checkbox
          checked={selected.has(target.id)}
          onCheckedChange={(checked) => onToggle([target], checked === true)}
          aria-label={`${database} auswählen`}
        />
        <span className="min-w-0 flex-1 truncate" title={database}>
          {database}
        </span>
        {schemasSupported && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
            Schemas
          </Button>
        )}
      </div>
      {open && schemasSupported && (
        <ul className="ml-10 border-l pl-2">
          {schemas.isLoading && (
            <li className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" /> Schemas werden geladen…
            </li>
          )}
          {schemas.error && (
            <li className="py-1 text-[11px] text-destructive">{String(schemas.error)}</li>
          )}
          {visibleSchemas.map((schema) => {
            const scoped = multiTarget(connection.id, database, schema);
            return (
              <li key={schema} className="flex items-center gap-2 py-0.5 text-xs">
                <Checkbox
                  checked={selected.has(scoped.id)}
                  onCheckedChange={(checked) => onToggle([scoped], checked === true)}
                  aria-label={`Schema ${schema} auswählen`}
                />
                <span className="truncate">{schema}</span>
              </li>
            );
          })}
          {visibleSchemas.length > 1 && (
            <li>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[11px]"
                onClick={() =>
                  onToggle(
                    visibleSchemas.map((schema) => multiTarget(connection.id, database, schema)),
                    true,
                  )
                }
              >
                Alle Schemas
              </Button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
