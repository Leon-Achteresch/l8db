import { FileCode2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DbFunction } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseDefinitionDialog, type DefinitionTarget } from "./database-definition-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseSchemaSelect } from "./database-schema-select";
import { DatabaseTable } from "./database-table";
import { useDatabaseList } from "./use-database-list";

export function DatabaseFunctionsTab({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbFunction>(reference, "functions", { schema });
  const [definition, setDefinition] = useState<DefinitionTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Funktionen in diesem Schema."
        toolbar={<DatabaseSchemaSelect reference={reference} value={schema} onChange={setSchema} />}
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Argumente", "Rückgabe", "Sprache", "Sicherheit", ""]}>
            {items.map((fn) => (
              <tr key={fn.oid}>
                <td className="font-medium">
                  {fn.name} {fn.is_procedure && <Badge variant="outline">Prozedur</Badge>}
                </td>
                <td className="max-w-64 font-mono break-words">{fn.arguments || "–"}</td>
                <td className="font-mono">{fn.return_type ?? "–"}</td>
                <td>{fn.language}</td>
                <td>
                  <Badge variant={fn.security_definer ? "destructive" : "secondary"}>
                    {fn.security_definer ? "Definer" : "Invoker"}
                  </Badge>
                </td>
                <td className="text-right whitespace-nowrap">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Definition von ${fn.name}`}
                    onClick={() =>
                      setDefinition({
                        kind: "function",
                        oid: fn.oid,
                        title: `${fn.schema}.${fn.name}(${fn.arguments})`,
                      })
                    }
                  >
                    <FileCode2 />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${fn.name} löschen`}
                    onClick={() =>
                      setConfirm({
                        title: `Funktion „${fn.name}(${fn.arguments})“ löschen?`,
                        description: "Die Funktion wird dauerhaft gelöscht.",
                        action: { action: "drop_function", oid: fn.oid, cascade: false },
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
