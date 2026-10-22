import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DbPublicationTable } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabasePublicationTables({
  reference,
  publication,
}: {
  reference: string;
  publication: string;
}) {
  const list = useDatabaseList<DbPublicationTable>(reference, "publication_tables", {
    parent: publication,
  });
  const action = useDatabaseAction(reference);
  const [schema, setSchema] = useState("public");
  const [table, setTable] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Diese Publikation enthält keine Tabellen."
        toolbar={
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate(
                {
                  action: "set_publication_table",
                  publication,
                  schema,
                  table: table.trim(),
                  add: true,
                },
                { onSuccess: () => setTable("") },
              );
            }}
          >
            <DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />
            <Input
              className="h-8 w-40 text-xs"
              value={table}
              onChange={(event) => setTable(event.target.value)}
              placeholder="Tabelle"
              aria-label="Tabelle hinzufügen"
              required
            />
            <Button size="sm" type="submit" disabled={action.isPending}>
              <Plus /> Hinzufügen
            </Button>
          </form>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Schema", "Tabelle", ""]}>
            {items.map((item) => (
              <tr key={`${item.schema}.${item.name}`}>
                <td>{item.schema}</td>
                <td className="font-medium">{item.name}</td>
                <td className="text-right">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${item.name} aus ${publication} entfernen`}
                    onClick={() =>
                      setConfirm({
                        title: `${item.schema}.${item.name} entfernen?`,
                        description: `Änderungen an dieser Tabelle werden nicht mehr über „${publication}“ veröffentlicht.`,
                        confirmLabel: "Entfernen",
                        action: {
                          action: "set_publication_table",
                          publication,
                          schema: item.schema,
                          table: item.name,
                          add: false,
                        },
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
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
