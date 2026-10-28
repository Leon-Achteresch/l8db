import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounced } from "@/features/dashboard/use-dataset-query";
import type { DbIndex } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseIndexDialog } from "./database-index-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseList } from "./use-database-list";

export function DatabaseIndexesTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const [table, setTable] = useState("");
  const parent = useDebounced(table.trim(), 300);
  const list = useDatabaseList<DbIndex>(reference, "indexes", { schema, parent });
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Indizes gefunden."
        toolbar={
          <>
            <DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />
            <Input
              className="h-8 w-40 text-xs"
              value={table}
              onChange={(event) => {
                setTable(event.target.value);
                list.setOffset(0);
              }}
              placeholder="Tabelle (exakt)"
              aria-label="Nach Tabelle filtern"
            />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Index
            </Button>
          </>
        }
      >
        {(items) => (
          <DatabaseTable
            headers={["Tabelle", "Name", "Methode", "Größe", "Scans", "Definition", ""]}
          >
            {items.map((index) => (
              <tr key={index.oid}>
                <td>{index.table_name}</td>
                <td className="font-medium">
                  {index.name} {index.is_primary && <Badge variant="secondary">PK</Badge>}
                  {index.is_unique && !index.is_primary && <Badge variant="outline">Unique</Badge>}
                  {!index.is_valid && <Badge variant="destructive">Ungültig</Badge>}
                </td>
                <td>{index.method}</td>
                <td className="whitespace-nowrap">{index.size}</td>
                <td>{index.scans.toLocaleString("de-DE")}</td>
                <td className="max-w-80 font-mono break-words text-muted-foreground">
                  {index.definition}
                </td>
                <td className="text-right">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Index ${index.name} löschen`}
                    disabled={index.is_constraint}
                    title={
                      index.is_constraint
                        ? "Gehört zu einem Constraint und wird mit diesem gelöscht."
                        : undefined
                    }
                    onClick={() =>
                      setConfirm({
                        title: `Index „${index.name}“ löschen?`,
                        description: "Der Index wird dauerhaft gelöscht.",
                        action: {
                          action: "drop_index",
                          schema: index.schema,
                          name: index.name,
                          concurrently: false,
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
      <DatabaseIndexDialog
        reference={reference}
        schema={schema}
        open={creating}
        onOpenChange={setCreating}
      />
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
