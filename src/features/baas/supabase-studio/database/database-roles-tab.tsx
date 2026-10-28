import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DbRole } from "@/lib/db/supabase-studio-database";
import { type ConfirmRequest, DatabaseConfirmDialog } from "./database-confirm-dialog";
import { DatabaseListFrame } from "./database-list-frame";
import { DatabaseRoleDialog, type RoleDialogMode } from "./database-role-dialog";
import { DatabaseTable } from "./database-table";
import { useDatabaseList } from "./use-database-list";

const ATTRIBUTES: [keyof DbRole, string][] = [
  ["superuser", "Superuser"],
  ["login", "Login"],
  ["inherit", "Inherit"],
  ["createdb", "CreateDB"],
  ["createrole", "CreateRole"],
  ["replication", "Replication"],
  ["bypassrls", "BypassRLS"],
];

const PROTECTED = "Supabase-Systemrollen sind geschützt.";

export function DatabaseRolesTab({ reference }: { reference: string }) {
  const list = useDatabaseList<DbRole>(reference, "roles");
  const [dialog, setDialog] = useState<RoleDialogMode | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <DatabaseListFrame
        list={list}
        empty="Keine Rollen gefunden."
        toolbar={
          <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
            <Plus /> Rolle
          </Button>
        }
      >
        {(items) => (
          <DatabaseTable headers={["Name", "Attribute", "Verbindungen", "Mitglied von", ""]}>
            {items.map((role) => (
              <tr key={role.oid}>
                <td className="font-medium">
                  {role.name} {role.protected && <Badge variant="secondary">System</Badge>}
                </td>
                <td>
                  <div className="flex max-w-80 flex-wrap gap-1">
                    {ATTRIBUTES.filter(([key]) => role[key]).map(([key, label]) => (
                      <Badge key={key} variant="outline">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>{role.connection_limit < 0 ? "∞" : role.connection_limit}</td>
                <td className="max-w-64 text-muted-foreground">{role.member_of.join(", ")}</td>
                <td className="text-right whitespace-nowrap">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Rolle ${role.name} bearbeiten`}
                    disabled={role.protected}
                    title={role.protected ? PROTECTED : undefined}
                    onClick={() => setDialog({ kind: "edit", role })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Passwort für ${role.name} setzen`}
                    disabled={role.protected}
                    title={role.protected ? PROTECTED : undefined}
                    onClick={() => setDialog({ kind: "password", role })}
                  >
                    <KeyRound />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Rolle ${role.name} löschen`}
                    disabled={role.protected}
                    title={role.protected ? PROTECTED : undefined}
                    onClick={() =>
                      setConfirm({
                        title: `Rolle „${role.name}“ löschen?`,
                        description:
                          "Die Rolle wird dauerhaft gelöscht. Besitzt sie noch Objekte oder Rechte, schlägt das Löschen fehl.",
                        action: { action: "drop_role", name: role.name },
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
      {dialog && (
        <DatabaseRoleDialog reference={reference} mode={dialog} onClose={() => setDialog(null)} />
      )}
      <DatabaseConfirmDialog
        reference={reference}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
