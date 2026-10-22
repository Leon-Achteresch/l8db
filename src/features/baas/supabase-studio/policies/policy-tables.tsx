import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { DbRlsTable } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "../database/database-confirm-dialog";
import { DatabaseListFrame } from "../database/database-list-frame";
import { DatabaseSchemaSelect } from "../database/database-schema-select";
import { DatabaseTable } from "../database/database-table";
import { useDatabaseAction } from "../database/use-database-action";
import { useDatabaseList } from "../database/use-database-list";
import { PolicyList } from "./policy-list";

export function PolicyTables({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbRlsTable>(reference, "rls_tables", { schema });
  const action = useDatabaseAction(reference);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Tabellen in diesem Schema."
        toolbar={
          <DatabaseSchemaSelect
            reference={reference}
            value={schema}
            onChange={(value) => {
              setSchema(value);
              setOpen(null);
            }}
          />
        }
      >
        {(items) => (
          <DatabaseTable headers={["Tabelle", "RLS", "Erzwungen", "Richtlinien"]}>
            {items.map((table) => (
              <Fragment key={table.oid}>
                <tr>
                  <td className="font-medium">
                    {table.name}{" "}
                    {!table.rls_enabled && <Badge variant="destructive">Ungeschützt</Badge>}
                  </td>
                  <td>
                    <Switch
                      size="sm"
                      checked={table.rls_enabled}
                      disabled={action.isPending}
                      aria-label={`RLS für ${table.name}`}
                      onCheckedChange={(enabled) =>
                        enabled
                          ? action.mutate({
                              action: "set_rls",
                              schema,
                              table: table.name,
                              mode: "enable",
                            })
                          : setConfirm({
                              title: `RLS für „${table.name}“ deaktivieren?`,
                              description:
                                "Ohne Row Level Security kann jeder mit dem anon- oder publishable Key alle Zeilen dieser Tabelle über die Data API lesen und ändern, sofern Rechte vergeben sind.",
                              confirmLabel: "Deaktivieren",
                              action: {
                                action: "set_rls",
                                schema,
                                table: table.name,
                                mode: "disable",
                              },
                            })
                      }
                    />
                  </td>
                  <td>
                    <Switch
                      size="sm"
                      checked={table.rls_forced}
                      disabled={action.isPending || !table.rls_enabled}
                      title="Richtlinien gelten auch für den Tabellenbesitzer"
                      aria-label={`RLS für ${table.name} erzwingen`}
                      onCheckedChange={(forced) =>
                        action.mutate({
                          action: "set_rls",
                          schema,
                          table: table.name,
                          mode: forced ? "force" : "no_force",
                        })
                      }
                    />
                  </td>
                  <td>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setOpen(open === table.name ? null : table.name)}
                    >
                      {open === table.name ? <ChevronDown /> : <ChevronRight />}
                      {table.policy_count}
                    </Button>
                  </td>
                </tr>
                {open === table.name && (
                  <tr>
                    <td colSpan={4} className="bg-muted/20">
                      <PolicyList reference={reference} schema={schema} table={table.name} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
