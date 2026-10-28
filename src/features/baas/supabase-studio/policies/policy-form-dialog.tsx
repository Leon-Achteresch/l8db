import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DbPolicy, PolicyCommand, PolicyInput } from "@/lib/db/supabase-studio-database";
import { useDatabaseAction } from "../database/use-database-action";

const COMMANDS: PolicyCommand[] = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

const TEMPLATES: { label: string; policy: Omit<PolicyInput, "name">; name: string }[] = [
  {
    label: "Jeder darf lesen",
    name: "Jeder darf lesen",
    policy: {
      command: "SELECT",
      permissive: true,
      roles: [],
      using_expression: "true",
      check_expression: "",
    },
  },
  {
    label: "Nur eigene Zeilen (auth.uid() = user_id)",
    name: "Nur eigene Zeilen",
    policy: {
      command: "ALL",
      permissive: true,
      roles: ["authenticated"],
      using_expression: "(select auth.uid()) = user_id",
      check_expression: "(select auth.uid()) = user_id",
    },
  },
  {
    label: "Nur authentifizierte",
    name: "Nur authentifizierte",
    policy: {
      command: "ALL",
      permissive: true,
      roles: ["authenticated"],
      using_expression: "true",
      check_expression: "true",
    },
  },
];

const EMPTY: PolicyInput = {
  name: "",
  command: "SELECT",
  permissive: true,
  roles: [],
  using_expression: "",
  check_expression: "",
};

export function PolicyFormDialog({
  reference,
  schema,
  table,
  policy,
  onClose,
}: {
  reference: string;
  schema: string;
  table: string;
  policy: DbPolicy | null;
  onClose: () => void;
}) {
  const action = useDatabaseAction(reference);
  const [form, setForm] = useState<PolicyInput>(
    policy
      ? {
          name: policy.name,
          command: policy.command,
          permissive: policy.permissive,
          roles: policy.roles.filter((role) => role !== "public"),
          using_expression: policy.using_expression ?? "",
          check_expression: policy.check_expression ?? "",
        }
      : EMPTY,
  );
  const [roles, setRoles] = useState(form.roles.join(", "));
  const usesUsing = form.command !== "INSERT";
  const usesCheck = form.command !== "SELECT" && form.command !== "DELETE";
  const submit = () => {
    const input: PolicyInput = {
      ...form,
      name: form.name.trim(),
      roles: roles
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
      using_expression: usesUsing ? form.using_expression : "",
      check_expression: usesCheck ? form.check_expression : "",
    };
    action.mutate(
      policy
        ? {
            action: "update_policy",
            schema,
            table,
            original: policy.name,
            policy: input,
          }
        : { action: "create_policy", schema, table, policy: input },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{policy ? "Richtlinie bearbeiten" : "Richtlinie erstellen"}</DialogTitle>
            <DialogDescription>
              {schema}.{table}
              {policy &&
                " · Änderungen an Befehl oder Art ersetzen die Richtlinie in einer Transaktion."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((template) => (
              <Button
                key={template.label}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setForm({ ...template.policy, name: form.name || template.name });
                  setRoles(template.policy.roles.join(", "));
                }}
              >
                {template.label}
              </Button>
            ))}
          </div>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Name"
            aria-label="Name der Richtlinie"
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.command}
              onValueChange={(value) => setForm({ ...form, command: value as PolicyCommand })}
            >
              <SelectTrigger aria-label="Befehl" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMANDS.map((command) => (
                  <SelectItem key={command} value={command}>
                    {command}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={form.permissive ? "permissive" : "restrictive"}
              onValueChange={(value) => setForm({ ...form, permissive: value === "permissive" })}
            >
              <SelectTrigger aria-label="Art" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="permissive">Permissiv (OR)</SelectItem>
                <SelectItem value="restrictive">Restriktiv (AND)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            value={roles}
            onChange={(event) => setRoles(event.target.value)}
            placeholder="Rollen, durch Komma getrennt (leer = public)"
            aria-label="Rollen"
          />
          {usesUsing && (
            <Label className="flex flex-col items-stretch gap-1 text-xs">
              USING (welche Zeilen sichtbar sind)
              <Textarea
                className="font-mono text-xs"
                value={form.using_expression}
                onChange={(event) => setForm({ ...form, using_expression: event.target.value })}
                placeholder="(select auth.uid()) = user_id"
              />
            </Label>
          )}
          {usesCheck && (
            <Label className="flex flex-col items-stretch gap-1 text-xs">
              WITH CHECK (welche Zeilen geschrieben werden dürfen)
              <Textarea
                className="font-mono text-xs"
                value={form.check_expression}
                onChange={(event) => setForm({ ...form, check_expression: event.target.value })}
                placeholder="(select auth.uid()) = user_id"
              />
            </Label>
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
