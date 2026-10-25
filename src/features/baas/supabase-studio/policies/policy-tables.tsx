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
import { PolicyAccessCell } from "./policy-access-cell";
import { PolicyCoverageSummary } from "./policy-coverage-summary";
import { PolicyList } from "./policy-list";

export function PolicyTables({ reference }: { reference: string }) {
  const [schema, setSchema] = useState("public");
  const list = useDatabaseList<DbRlsTable>(reference, "rls_tables", { schema });
  const action = useDatabaseAction(reference);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const commands = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
  return (
    <>
      {list.query.data && list.query.data.items.length > 0 && (
        <div className="mb-4">
          <PolicyCoverageSummary tables={list.query.data.items} />
        </div>
      )}
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
          <DatabaseTable headers={["Tabelle", "RLS", "Erzwungen", ...commands, "Richtlinien"]}>
            {items.map((table) => (
              <Fragment key={table.oid}>
                <tr
                  className={`[&>td]:align-middle ${table.rls_enabled ? "" : "bg-destructive/[0.035]"}`}
                >
                  <td className="font-medium">{table.name}</td>
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
                  {table.rls_enabled ? (
                    commands.map((command) => (
                      <PolicyAccessCell
                        key={command}
                        command={command}
                        commands={table.commands ?? []}
                      />
                    ))
                  ) : (
                    <td colSpan={commands.length} className="text-center">
                      <Badge variant="destructive">Ungeschützt: Data API ohne Zeilenfilter</Badge>
                    </td>
                  )}
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
                    <td colSpan={commands.length + 4} className="bg-muted/20">
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
