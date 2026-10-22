import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DbPolicy } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "../database/database-confirm-dialog";
import { DatabaseListFrame } from "../database/database-list-frame";
import { DatabaseTable } from "../database/database-table";
import { useDatabaseList } from "../database/use-database-list";
import { PolicyFormDialog } from "./policy-form-dialog";

export function PolicyList({
  reference,
  schema,
  table,
}: {
  reference: string;
  schema: string;
  table: string;
}) {
  const list = useDatabaseList<DbPolicy>(reference, "policies", { schema, parent: table });
  const [editing, setEditing] = useState<DbPolicy | "new" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Richtlinien für diese Tabelle."
        toolbar={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> Richtlinie
          </Button>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Befehl", "Rollen", "Art", "USING", "WITH CHECK", ""]}>
            {items.map((policy) => (
              <tr key={policy.name}>
                <td className="font-medium">{policy.name}</td>
                <td>
                  <Badge variant="outline">{policy.command}</Badge>
                </td>
                <td>{policy.roles.join(", ")}</td>
                <td>{policy.permissive ? "Permissiv" : "Restriktiv"}</td>
                <td className="max-w-64 font-mono break-words">{policy.using_expression ?? "–"}</td>
                <td className="max-w-64 font-mono break-words">{policy.check_expression ?? "–"}</td>
                <td className="text-right whitespace-nowrap">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Richtlinie ${policy.name} bearbeiten`}
                    onClick={() => setEditing(policy)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Richtlinie ${policy.name} löschen`}
                    onClick={() =>
                      setConfirm({
                        title: `Richtlinie „${policy.name}“ löschen?`,
                        description: `Die Richtlinie auf ${schema}.${table} wird dauerhaft gelöscht.`,
                        action: { action: "drop_policy", schema, table, name: policy.name },
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
      {editing && (
        <PolicyFormDialog
          reference={reference}
          schema={schema}
          table={table}
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
