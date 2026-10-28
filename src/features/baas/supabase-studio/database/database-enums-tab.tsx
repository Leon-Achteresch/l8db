import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DbEnum } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseEnumRow } from "./database-enum-row";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseAction } from "./use-database-action";
import { useDatabaseList } from "./use-database-list";

export function DatabaseEnumsTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbEnum>(reference, "enums", { schema });
  const action = useDatabaseAction(reference);
  const [name, setName] = useState("");
  const [values, setValues] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Enums in diesem Schema."
        toolbar={
          <>
            <DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                action.mutate(
                  {
                    action: "create_enum",
                    schema,
                    name: name.trim(),
                    values: values
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                  {
                    onSuccess: () => {
                      setName("");
                      setValues("");
                    },
                  },
                );
              }}
            >
              <Input
                className="h-8 w-36 text-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Neuer Enum"
                aria-label="Name des neuen Enums"
                required
              />
              <Input
                className="h-8 w-52 text-xs"
                value={values}
                onChange={(event) => setValues(event.target.value)}
                placeholder="Werte, durch Komma getrennt"
                aria-label="Werte des neuen Enums"
              />
              <Button size="sm" type="submit" disabled={action.isPending}>
                <Plus /> Erstellen
              </Button>
            </form>
          </>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Werte", "Bearbeiten", ""]}>
            {items.map((item) => (
              <tr key={item.oid}>
                <td className="font-medium">{item.name}</td>
                <td>
                  <div className="flex max-w-96 flex-wrap gap-1">
                    {item.enum_values.map((value) => (
                      <Badge key={value} variant="outline">
                        {value}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>
                  <DatabaseEnumRow reference={reference} item={item} />
                </td>
                <td className="text-right">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Enum ${item.name} löschen`}
                    onClick={() =>
                      setConfirm({
                        title: `Enum „${item.name}“ löschen?`,
                        description: "Der Typ wird dauerhaft gelöscht.",
                        action: {
                          action: "drop_enum",
                          schema: item.schema,
                          name: item.name,
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
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
