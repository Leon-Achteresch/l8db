import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DbSchema } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabaseSchemasTab({ reference }: { reference: string }) {
  const list = useDatabaseList<DbSchema>(reference, "schemas");
  const action = useDatabaseAction(reference);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Schemas gefunden."
        toolbar={
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate(
                { action: "create_schema", name: name.trim() },
                { onSuccess: () => setName("") },
              );
            }}
          >
            <Input
              className="h-8 w-44 text-xs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Neues Schema"
              aria-label="Name des neuen Schemas"
              required
            />
            <Button size="sm" type="submit" disabled={action.isPending}>
              <Plus /> Erstellen
            </Button>
          </form>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Besitzer", "Tabellen", ""]}>
            {items.map((schema) => (
              <tr key={schema.name}>
                <td className="font-medium">
                  {schema.name} {schema.protected && <Badge variant="secondary">Supabase</Badge>}
                </td>
                <td>{schema.owner}</td>
                <td>{schema.table_count}</td>
                <td className="text-right">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Schema ${schema.name} löschen`}
                    disabled={schema.protected || schema.name === "public"}
                    title={
                      schema.protected || schema.name === "public"
                        ? "Von Supabase verwaltete Schemas können nicht gelöscht werden."
                        : undefined
                    }
                    onClick={() =>
                      setConfirm({
                        title: `Schema „${schema.name}“ löschen?`,
                        description: "Das Schema wird dauerhaft gelöscht.",
                        action: { action: "drop_schema", name: schema.name, cascade: false },
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
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
