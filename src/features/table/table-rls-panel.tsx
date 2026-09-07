import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { type CreatePolicyRequest, createPolicy, dropPolicy, setTableRls } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useTableRlsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

interface TableRlsPanelProps {
  schema: string;
  table: string;
}

const POLICY_COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

function CreatePolicyDialog({
  schema,
  table,
  open,
  onOpenChange,
  onSuccess,
}: {
  schema: string;
  table: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("ALL");
  const [roles, setRoles] = useState("PUBLIC");
  const [usingExpr, setUsingExpr] = useState("");
  const [checkExpr, setCheckExpr] = useState("");

  const handleSave = async () => {
    if (!connection || !name.trim()) return;
    setSaving(true);
    try {
      const request: CreatePolicyRequest = {
        name: name.trim(),
        command,
        roles: roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
      };
      if (usingExpr.trim()) request.using_expr = usingExpr.trim();
      if (checkExpr.trim()) request.check_expr = checkExpr.trim();
      await createPolicy(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        request,
        database ?? undefined,
      );
      toast.success(`Policy "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setUsingExpr("");
      setCheckExpr("");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Neue Policy für {schema}.{table}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs font-mono"
                placeholder="z. B. owner_isolation"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Befehl</Label>
              <Select value={command} onValueChange={setCommand}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {POLICY_COMMANDS.map((cmd) => (
                    <SelectItem key={cmd} value={cmd}>
                      {cmd}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rollen (kommagetrennt, leer = PUBLIC)</Label>
            <Input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="PUBLIC"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">USING-Ausdruck (optional)</Label>
            <Input
              value={usingExpr}
              onChange={(e) => setUsingExpr(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. owner = current_user"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">WITH CHECK-Ausdruck (optional)</Label>
            <Input
              value={checkExpr}
              onChange={(e) => setCheckExpr(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. owner = current_user"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TableRlsPanel({ schema, table }: TableRlsPanelProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useTableRlsQuery(schema, table);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rls"] });
  };

  const handleToggle = async (enabled: boolean, force: boolean) => {
    if (!connection || !data) return;
    setToggling(true);
    try {
      await setTableRls(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        enabled,
        force,
        database ?? undefined,
      );
      toast.success(enabled ? "Row Level Security aktiviert." : "Row Level Security deaktiviert.");
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setToggling(false);
    }
  };

  const handleDrop = async (name: string) => {
    if (!connection) return;
    try {
      await dropPolicy(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        name,
        database ?? undefined,
      );
      toast.success(`Policy "${name}" gelöscht.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade RLS-Status…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-destructive">{String(error ?? "Fehler beim Laden.")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b bg-muted/30 px-4 py-2.5">
        <ShieldIcon className="size-4 text-emerald-500" />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={data.rls_enabled}
            disabled={toggling}
            onCheckedChange={(v) => void handleToggle(v, data.force_rls)}
          />
          RLS {data.rls_enabled ? "aktiv" : "inaktiv"}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={data.force_rls}
            disabled={toggling || !data.rls_enabled}
            onCheckedChange={(v) => void handleToggle(data.rls_enabled, v)}
          />
          FORCE (auch für Owner)
        </label>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Neue Policy
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {data.policies.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Keine Policies vorhanden.
            {!data.rls_enabled &&
              " Aktiviere RLS und lege eine Policy an, um Zeilenzugriff zu steuern."}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {data.policies.map((policy) => (
              <motion.div
                key={policy.name}
                layout
                transition={{ layout: SPRING_LAYOUT }}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent/60"
              >
                <ShieldIcon className="size-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{policy.name}</p>
                  {(policy.using_expr || policy.check_expr) && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {[
                        policy.using_expr && `USING (${policy.using_expr})`,
                        policy.check_expr && `CHECK (${policy.check_expr})`,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                  {policy.command}
                </Badge>
                <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
                  {policy.roles.join(", ")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void handleDrop(policy.name)}
                  title={`Policy "${policy.name}" löschen`}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      <CreatePolicyDialog
        schema={schema}
        table={table}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={refresh}
      />
    </div>
  );
}
