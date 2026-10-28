import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { useState } from "react";
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
  type ConvexDocument,
  convexDataClear,
  convexDataDeleteTable,
  convexDataImport,
  convexDataSchema,
  convexDataTables,
} from "@/lib/db/convex-studio-data";
import { BaasTableTabs } from "../../baas-table-tabs";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { ConvexDataConfirmDialog } from "./convex-data-confirm-dialog";
import { ConvexDataDocuments } from "./convex-data-documents";
import { ConvexDataImportDialog } from "./convex-data-import-dialog";
import { ConvexDataSchemaView } from "./convex-data-schema-view";
import { dataKey } from "./convex-data-utils";

export function ConvexDataTableView({
  deployment,
  table,
  onOpenDocument,
  onOpenReference,
  onDeleted,
}: {
  deployment: ConvexStudioDeployment;
  table: string;
  onOpenDocument: (document: ConvexDocument) => void;
  onOpenReference: (id: string) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"import" | "clear" | "drop" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState("data");
  const tables = useQuery({
    queryKey: [...dataKey(deployment), "tables"],
    queryFn: () => convexDataTables(deployment),
    staleTime: 30_000,
  });
  const schema = useQuery({
    queryKey: [...dataKey(deployment), "schema"],
    queryFn: () => convexDataSchema(deployment),
    staleTime: 60_000,
  });
  const count = tables.data?.tables.find((item) => item.name === table)?.documents;
  const refresh = () => queryClient.invalidateQueries({ queryKey: dataKey(deployment) });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3">
          <BaasTableTabs />
          <h3 className="truncate font-mono text-xs font-medium">{table}</h3>
          {typeof count === "number" && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {count.toLocaleString("de-DE")} Dokumente
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Tabellenaktionen">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAction("import")}>
                <Upload className="size-3.5" /> Importieren…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setAction("clear")}>
                <Eraser className="size-3.5" /> Tabelle leeren…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setAction("drop")}>
                <Trash2 className="size-3.5" /> Tabelle löschen…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {message && (
          <p role="status" className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
            {message}
          </p>
        )}
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <ConvexDataDocuments
            deployment={deployment}
            table={table}
            schema={schema.data}
            onOpenDocument={onOpenDocument}
            onOpenReference={onOpenReference}
          />
        </TabsContent>
        <TabsContent value="columns" className="min-h-0 flex-1 overflow-auto p-4">
          <ConvexDataSchemaView
            deployment={deployment}
            table={table}
            schema={schema.data}
            loading={schema.isPending}
            error={schema.error}
          />
        </TabsContent>
      </Tabs>
      {action === "import" && (
        <ConvexDataImportDialog
          table={table}
          onOpenChange={(open) => !open && setAction(null)}
          onImport={async (format, mode, content) => {
            const written = await convexDataImport(deployment, table, format, mode, content);
            setMessage(`${written.toLocaleString("de-DE")} Dokumente importiert.`);
            await refresh();
          }}
        />
      )}
      <ConvexDataConfirmDialog
        open={action === "clear"}
        title={`${table} leeren?`}
        description="Alle Dokumente der Tabelle werden endgültig gelöscht. Tabelle, Schema und Indizes bleiben erhalten."
        action="Leeren"
        typedName={table}
        onOpenChange={(open) => !open && setAction(null)}
        onConfirm={async () => {
          const deleted = await convexDataClear(deployment, table);
          setMessage(`${deleted.toLocaleString("de-DE")} Dokumente gelöscht.`);
          await refresh();
        }}
      />
      <ConvexDataConfirmDialog
        open={action === "drop"}
        title={`${table} löschen?`}
        description="Die Tabelle wird mit allen Dokumenten und Indizes endgültig gelöscht. Steht sie in schema.ts, legt der nächste Push sie leer neu an."
        action="Tabelle löschen"
        typedName={table}
        onOpenChange={(open) => !open && setAction(null)}
        onConfirm={async () => {
          await convexDataDeleteTable(deployment, table);
          await refresh();
          onDeleted();
        }}
      />
    </div>
  );
}
