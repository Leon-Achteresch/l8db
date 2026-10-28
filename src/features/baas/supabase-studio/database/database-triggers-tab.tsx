import { FileCode2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDebounced } from "@/features/dashboard/use-dataset-query";
import type { DbTrigger } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseDefinitionDialog, type DefinitionTarget } from "./database-definition-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabaseTriggersTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const [table, setTable] = useState("");
  const parent = useDebounced(table.trim(), 300);
  const list = useDatabaseList<DbTrigger>(reference, "triggers", { schema, parent });
  const action = useDatabaseAction(reference);
  const [definition, setDefinition] = useState<DefinitionTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Trigger gefunden."
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
          </>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Tabelle", "Name", "Aktiv", "Definition", "Funktion", ""]}>
            {items.map((trigger) => (
              <tr key={trigger.oid}>
                <td>{trigger.table_name}</td>
                <td className="font-medium">{trigger.name}</td>
                <td>
                  <Switch
                    size="sm"
                    checked={trigger.enabled}
                    disabled={action.isPending}
                    aria-label={`Trigger ${trigger.name} aktiv`}
                    onCheckedChange={(enabled) =>
                      action.mutate({
                        action: "set_trigger",
                        schema: trigger.schema,
                        table: trigger.table_name,
                        name: trigger.name,
                        enabled,
                      })
                    }
                  />
                </td>
                <td className="max-w-80 font-mono break-words text-muted-foreground">
                  {trigger.definition}
                </td>
                <td>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setDefinition({
                        kind: "function",
                        oid: trigger.function_oid,
                        title: trigger.function_name,
                      })
                    }
                  >
                    <FileCode2 /> {trigger.function_name}
                  </Button>
                </td>
                <td className="text-right">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Trigger ${trigger.name} löschen`}
                    onClick={() =>
                      setConfirm({
                        title: `Trigger „${trigger.name}“ löschen?`,
                        description: `Der Trigger auf ${trigger.schema}.${trigger.table_name} wird dauerhaft gelöscht.`,
                        action: {
                          action: "drop_trigger",
                          schema: trigger.schema,
                          table: trigger.table_name,
                          name: trigger.name,
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
