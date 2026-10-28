import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  studioTablesDescribe,
  studioTablesDropTable,
  studioTablesRenameTable,
  studioTablesSetRls,
  studioTablesTruncate,
} from "@/lib/db/supabase-studio-tables";
import { BaasTableTabs } from "../../baas-table-tabs";
import { SupabaseTableConfirmDialog } from "./supabase-table-confirm-dialog";
import { SupabaseTableGrid } from "./supabase-table-grid";
import { SupabaseTableRenameDialog } from "./supabase-table-rename-dialog";
import { SupabaseTableStructure } from "./supabase-table-structure";
import { isWritableKind, KIND_LABELS, type StudioTableRef } from "./supabase-tables-utils";

export function SupabaseTableEditor({
  reference,
  table,
  sql,
  onSelect,
}: {
  reference: string;
  table: StudioTableRef;
  sql: boolean;
  onSelect: (table: StudioTableRef | null) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("data");
  const [dialog, setDialog] = useState<"rename" | "truncate" | "drop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const describeKey = [
    "supabase",
    reference,
    "studio-tables",
    "describe",
    table.schema,
    table.name,
  ];
  const info = useQuery({
    queryKey: describeKey,
    queryFn: () => studioTablesDescribe(reference, table.schema, table.name),
  });

  function invalidateAll(gone = false) {
    void queryClient.invalidateQueries({
      queryKey: ["supabase", reference, "studio-tables"],
      predicate: ({ queryKey }) =>
        !gone || queryKey[4] !== table.schema || queryKey[5] !== table.name,
    });
  }

  async function toggleRls(enabled: boolean) {
    setError(null);
    try {
      await studioTablesSetRls(reference, table.schema, table.name, enabled);
      invalidateAll();
    } catch (cause) {
      setError(String(cause));
    }
  }

  if (info.isPending)
    return <p className="p-4 text-xs text-muted-foreground">Tabelle wird geladen…</p>;
  if (info.isError)
    return (
      <p role="alert" className="p-4 text-xs text-destructive">
        {String(info.error)}
      </p>
    );

  const data = info.data;
  const isTable = isWritableKind(data.kind) && data.kind !== "unknown";
  const hasDefinition = data.view_definition !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3">
          <BaasTableTabs definition={hasDefinition} />
          <h3 className="truncate font-mono text-xs font-medium">
            {data.schema}.{data.name}
          </h3>
          <Badge variant="secondary">{KIND_LABELS[data.kind]}</Badge>
          {data.rls_enabled !== null && isTable && (
            <Badge variant={data.rls_enabled ? "outline" : "destructive"}>
              {data.rls_enabled ? "RLS aktiv" : "RLS aus"}
            </Badge>
          )}
          {sql && data.introspected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Tabellenaktionen">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("rename")}>
                  Umbenennen…
                </DropdownMenuItem>
                {isTable && (
                  <DropdownMenuItem onSelect={() => void toggleRls(!data.rls_enabled)}>
                    {data.rls_enabled ? "RLS deaktivieren" : "RLS aktivieren"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {isTable && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog("truncate")}>
                    Alle Zeilen löschen…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("drop")}>
                  {KIND_LABELS[data.kind]} löschen…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!sql && (
          <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
            Schemaänderungen benötigen SQL-Zugriff: Secret Key einer selbst gehosteten Instanz oder
            Supabase-Zugangstoken.
          </p>
        )}
        {error && (
          <p role="alert" className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          {tab === "data" && (
            <SupabaseTableGrid
              key={data.columns.map((column) => column.name).join(",")}
              reference={reference}
              info={data}
              sql={sql}
            />
          )}
        </TabsContent>
        <TabsContent value="columns" className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "columns" && (
            <SupabaseTableStructure
              reference={reference}
              info={data}
              sql={sql}
              onChanged={() => invalidateAll()}
            />
          )}
        </TabsContent>
        {hasDefinition && (
          <TabsContent value="definition" className="min-h-0 flex-1 overflow-auto p-4">
            <pre className="rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {data.view_definition}
            </pre>
          </TabsContent>
        )}
      </Tabs>
      {dialog === "rename" && (
        <SupabaseTableRenameDialog
          current={data.name}
          onOpenChange={(open) => !open && setDialog(null)}
          onRename={async (name) => {
            await studioTablesRenameTable(reference, data.schema, data.name, name);
            onSelect({ schema: data.schema, name });
            invalidateAll(true);
          }}
        />
      )}
      <SupabaseTableConfirmDialog
        open={dialog === "truncate"}
        title={`Alle Zeilen aus ${data.name} löschen?`}
        description="TRUNCATE entfernt sofort alle Zeilen der Tabelle. Der Vorgang kann nicht rückgängig gemacht werden."
        action="Alle löschen"
        options={[
          { id: "restartIdentity", label: "Identity-Zähler zurücksetzen" },
          { id: "cascade", label: "Abhängige Tabellen ebenfalls leeren (CASCADE)" },
        ]}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={async (options) => {
          await studioTablesTruncate(
            reference,
            data.schema,
            data.name,
            Boolean(options.restartIdentity),
            Boolean(options.cascade),
          );
          invalidateAll();
        }}
      />
      <SupabaseTableConfirmDialog
        open={dialog === "drop"}
        title={`${data.schema}.${data.name} löschen?`}
        description={`${KIND_LABELS[data.kind]} und alle Daten werden endgültig gelöscht.`}
        action="Löschen"
        options={[{ id: "cascade", label: "Abhängige Objekte mitlöschen (CASCADE)" }]}
        onOpenChange={(open) => !open && setDialog(null)}
        onConfirm={async (options) => {
          await studioTablesDropTable(
            reference,
            data.schema,
            data.name,
            data.kind,
            Boolean(options.cascade),
          );
          onSelect(null);
          invalidateAll(true);
        }}
      />
    </div>
  );
}
