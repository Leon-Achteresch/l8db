import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexDataCreateTable, convexDataTables } from "@/lib/db/convex-studio-data";
import { BaasSidebarItem } from "../../baas-sidebar-item";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { ConvexDataCreateTableDialog } from "./convex-data-create-table-dialog";
import { dataKey } from "./convex-data-utils";

export function ConvexDataTableList({
  deployment,
  selected,
  onSelect,
}: {
  deployment: ConvexStudioDeployment;
  selected: string | null;
  onSelect: (table: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const tables = useQuery({
    queryKey: [...dataKey(deployment), "tables"],
    queryFn: () => convexDataTables(deployment),
    staleTime: 30_000,
  });
  const needle = search.trim().toLowerCase();
  const visible = (tables.data?.tables ?? []).filter((table) =>
    table.name.toLowerCase().includes(needle),
  );

  return (
    <div className="grid min-w-0 content-start gap-2">
      <div className="flex gap-1">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tabellen suchen"
          aria-label="Tabellen suchen"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Tabellen aktualisieren"
          disabled={tables.isFetching}
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: [...dataKey(deployment), "tables"] })
          }
        >
          <RefreshCw className={`size-3.5 ${tables.isFetching ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Tabelle erstellen"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      {tables.isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Tabellen werden geladen…</p>
      ) : tables.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(tables.error)}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          {needle ? "Keine passende Tabelle." : "Noch keine Tabellen."}
        </p>
      ) : (
        <div className="grid gap-0.5">
          {visible.map((table) => (
            <BaasSidebarItem
              key={table.name}
              icon={Table2}
              active={selected === table.name}
              onClick={() => onSelect(table.name)}
              hint={table.documents === null ? "–" : table.documents.toLocaleString("de-DE")}
            >
              {table.name}
            </BaasSidebarItem>
          ))}
        </div>
      )}
      {tables.data?.has_more && (
        <p className="text-[11px] text-muted-foreground">Nur die ersten 1000 Tabellen.</p>
      )}
      {creating && (
        <ConvexDataCreateTableDialog
          onOpenChange={setCreating}
          onCreate={async (name) => {
            await convexDataCreateTable(deployment, name);
            await queryClient.invalidateQueries({ queryKey: [...dataKey(deployment), "tables"] });
            onSelect(name);
          }}
        />
      )}
    </div>
  );
}
