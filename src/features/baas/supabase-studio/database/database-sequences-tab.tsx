import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DbSequence } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseList } from "./use-database-list";

export function DatabaseSequencesTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbSequence>(reference, "sequences", { schema });
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Sequenzen in diesem Schema."
        toolbar={<DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />}
      >
        {(items) => (
          <DatabaseTable
            headers={[
              "Name",
              "Typ",
              "Aktueller Wert",
              "Start",
              "Schritt",
              "Maximum",
              "Zurücksetzen",
            ]}
          >
            {items.map((sequence) => {
              const value = values[sequence.name] ?? sequence.start_value;
              return (
                <tr key={sequence.name}>
                  <td className="font-medium">{sequence.name}</td>
                  <td>{sequence.data_type}</td>
                  <td className="font-mono">{sequence.last_value ?? "Nicht verwendet"}</td>
                  <td className="font-mono">{sequence.start_value}</td>
                  <td className="font-mono">{sequence.increment}</td>
                  <td className="font-mono">{sequence.max_value}</td>
                  <td>
                    <div className="flex gap-1.5">
                      <Input
                        className="h-7 w-28 text-xs"
                        type="number"
                        value={value}
                        onChange={(event) =>
                          setValues({ ...values, [sequence.name]: event.target.value })
                        }
                        aria-label={`Neuer Startwert für ${sequence.name}`}
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${sequence.name} zurücksetzen`}
                        disabled={!Number.isSafeInteger(Number(value)) || value === ""}
                        onClick={() =>
                          setConfirm({
                            title: `Sequenz „${sequence.name}“ zurücksetzen?`,
                            description: `Der nächste Wert wird ${value}. Bereits vergebene Werte können dadurch erneut vergeben werden.`,
                            confirmLabel: "Zurücksetzen",
                            action: {
                              action: "reset_sequence",
                              schema: sequence.schema,
                              name: sequence.name,
                              value: Number(value),
                            },
                          })
                        }
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
