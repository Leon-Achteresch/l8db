import { FileCode2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DbView } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseDefinitionDialog, type DefinitionTarget } from "./database-definition-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabaseViewsTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbView>(reference, "views", { schema });
  const action = useDatabaseAction(reference);
  const [definition, setDefinition] = useState<DefinitionTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Views in diesem Schema."
        toolbar={<DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />}
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Art", "Beschreibung", ""]}>
            {items.map((view) => (
              <tr key={view.oid}>
                <td className="font-medium">{view.name}</td>
                <td>
                  <Badge variant="outline">{view.materialized ? "Materialisiert" : "View"}</Badge>
                  {view.materialized && !view.populated && (
                    <Badge variant="destructive" className="ml-1">
                      Nicht befüllt
                    </Badge>
                  )}
                </td>
                <td className="text-muted-foreground">{view.comment}</td>
                <td className="text-right whitespace-nowrap">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Definition von ${view.name}`}
                    onClick={() =>
                      setDefinition({
                        kind: "view",
                        oid: view.oid,
                        title: `${view.schema}.${view.name}`,
                      })
                    }
                  >
                    <FileCode2 />
                  </Button>
                  {view.materialized && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${view.name} aktualisieren`}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          action: "refresh_view",
                          schema: view.schema,
                          name: view.name,
                        })
                      }
                    >
                      <RefreshCw />
                    </Button>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${view.name} löschen`}
                    onClick={() =>
                      setConfirm({
                        title: `View „${view.name}“ löschen?`,
                        description: "Die View wird dauerhaft gelöscht.",
                        action: {
                          action: "drop_view",
                          schema: view.schema,
                          name: view.name,
                          materialized: view.materialized,
                          cascade: false,
                        },
                        cascade: true,
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </DatabaseTable>
        )}
      </DatabaseListFrame>
      <DatabaseDefinitionDialog
        reference={reference}
        target={definition}
        onClose={() => setDefinition(null)}
      />
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
