import { useNavigate } from "@tanstack/react-router";
import {
  BracesIcon,
  EyeIcon,
  LayoutGridIcon,
  ListTreeIcon,
  NetworkIcon,
  TableIcon,
  ZapIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useActiveConnection } from "@/lib/connections";
import type { DependencyInfo } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useUsedByQuery } from "@/lib/queries";
import { dependencyRoute, filterDependencies, groupDependencies } from "@/lib/used-by";

interface TableUsedByPanelProps {
  schema: string;
  name: string;
}

function DependencyIcon({ objectType }: { objectType: string }) {
  const type = objectType.toLowerCase();
  if (type.includes("view")) return <EyeIcon className="size-4 text-blue-500" />;
  if (type.includes("trigger")) return <ZapIcon className="size-4 text-amber-500" />;
  if (type.includes("table")) return <TableIcon className="size-4 text-muted-foreground" />;
  return <BracesIcon className="size-4 text-violet-500" />;
}

export function TableUsedByPanel({ schema, name }: TableUsedByPanelProps) {
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const { data, isLoading, isError, error } = useUsedByQuery(schema, name);
  const [mode, setMode] = useState<"tree" | "grid">("tree");
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => filterDependencies(data ?? [], term), [data, term]);
  const groups = useMemo(() => groupDependencies(filtered), [filtered]);

  const jump = (dep: DependencyInfo) => {
    const route = dependencyRoute(dep);
    if (!route) {
      toast.info(`${dep.object_type} ${dep.owner}.${dep.name} hat keine eigene Detailansicht.`);
      return;
    }
    if (route.kind === "table") {
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: route.schema, table: route.name },
        search: {},
      });
      return;
    }
    if (route.kind === "view") {
      void navigate({
        to: "/view-editor/$schema/$view",
        params: { schema: route.schema, view: route.name },
      });
      return;
    }
    void navigate({
      to: route.kind === "procedure" ? "/procedures/$schema/$name" : "/functions/$schema/$name",
      params: { schema: route.schema, name: route.name },
      search: route.oid ? { oid: route.oid } : {},
    });
  };

  const row = (dep: DependencyInfo, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => jump(dep)}
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/40"
    >
      <DependencyIcon objectType={dep.object_type} />
      <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{dep.owner}</span>
      <span className="min-w-0 flex-1 truncate font-mono">{dep.name}</span>
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
        {dep.object_type}
      </Badge>
      <Badge
        variant="outline"
        className={`shrink-0 px-1.5 py-0 text-[10px] ${
          dep.status.toUpperCase().startsWith("INVALID") ? "text-destructive" : ""
        }`}
      >
        {dep.status}
      </Badge>
      {dep.detail ? (
        <span className="hidden w-64 shrink-0 truncate text-[11px] text-muted-foreground lg:block">
          {dep.detail}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <NetworkIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Verwendet von · {connection?.name ?? "keine Verbindung"}
          {database ? ` · ${database}` : ""} · {schema}.{name}
        </span>
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Filtern…"
          className="ml-auto h-7 w-44 text-xs"
        />
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => value && setMode(value as "tree" | "grid")}
        >
          <ToggleGroupItem value="tree" aria-label="Baumansicht">
            <ListTreeIcon className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Listenansicht">
            <LayoutGridIcon className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Lade Verwendungen…
        </div>
      ) : isError ? (
        <p className="p-6 text-center text-sm text-destructive">{String(error)}</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            {(data?.length ?? 0) === 0
              ? "Keine Verwendungen gefunden."
              : "Keine Treffer für diesen Filter."}
          </p>
        </div>
      ) : mode === "grid" ? (
        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {filtered.map((dep, index) =>
            row(dep, `${dep.relation}-${dep.owner}-${dep.name}-${index}`),
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.relation}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.relation}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{group.items.length}</span>
              </div>
              <div className="divide-y">
                {group.items.map((dep, index) =>
                  row(dep, `${group.relation}-${dep.owner}-${dep.name}-${index}`),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
