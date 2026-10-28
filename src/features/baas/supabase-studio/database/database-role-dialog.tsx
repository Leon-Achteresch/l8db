import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DbRole, DbRoleAttributes } from "@/lib/db/supabase-studio-database";
import { useDatabaseAction } from "./use-database-action";

export type RoleDialogMode =
  | { kind: "create" }
  | { kind: "edit"; role: DbRole }
  | { kind: "password"; role: DbRole };

const FLAGS: [keyof Omit<DbRoleAttributes, "connection_limit">, string][] = [
  ["login", "Anmelden (LOGIN)"],
  ["inherit", "Rechte erben (INHERIT)"],
  ["createdb", "Datenbanken erstellen (CREATEDB)"],
  ["createrole", "Rollen erstellen (CREATEROLE)"],
  ["bypassrls", "RLS umgehen (BYPASSRLS)"],
];

const DEFAULTS: DbRoleAttributes = {
  login: true,
  inherit: true,
  createdb: false,
  createrole: false,
  bypassrls: false,
  connection_limit: -1,
};

export function DatabaseRoleDialog({
  reference,
  mode,
  onClose,
}: {
  reference: string;
  mode: RoleDialogMode;
  onClose: () => void;
}) {
  const action = useDatabaseAction(reference);
  const role = mode.kind === "create" ? null : mode.role;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [attributes, setAttributes] = useState<DbRoleAttributes>(
    role
      ? {
          login: role.login,
          inherit: role.inherit,
          createdb: role.createdb,
          createrole: role.createrole,
          bypassrls: role.bypassrls,
          connection_limit: role.connection_limit,
        }
      : DEFAULTS,
  );
  const title =
    mode.kind === "create"
      ? "Rolle erstellen"
      : mode.kind === "edit"
        ? "Rolle bearbeiten"
        : "Passwort setzen";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate(
              mode.kind === "create"
                ? { action: "create_role", name: name.trim(), attributes, password }
                : mode.kind === "edit"
                  ? { action: "alter_role", name: mode.role.name, attributes }
                  : { action: "set_role_password", name: mode.role.name, password },
              { onSuccess: onClose },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {role && <DialogDescription>{role.name}</DialogDescription>}
          </DialogHeader>
          {mode.kind === "create" && (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rollenname"
              aria-label="Rollenname"
              required
            />
          )}
          {mode.kind !== "password" && (
            <>
              {FLAGS.map(([key, label]) => (
                <Label key={key} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={attributes[key]}
                    onCheckedChange={(value) =>
                      setAttributes({ ...attributes, [key]: value === true })
                    }
                  />
                  {label}
                </Label>
              ))}
              <Label className="flex items-center gap-2 text-xs">
                Verbindungslimit (-1 = unbegrenzt)
                <Input
                  className="h-8 w-24"
                  type="number"
                  min={-1}
                  value={attributes.connection_limit}
                  onChange={(event) =>
                    setAttributes({ ...attributes, connection_limit: Number(event.target.value) })
                  }
                />
              </Label>
            </>
          )}
          {mode.kind !== "edit" && (
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode.kind === "create" ? "Passwort (optional, mind. 8 Zeichen)" : "Neues Passwort"
              }
              aria-label="Passwort"
              minLength={8}
              required={mode.kind === "password"}
              autoComplete="new-password"
            />
          )}
          <DialogFooter>
            <Button type="submit" disabled={action.isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
