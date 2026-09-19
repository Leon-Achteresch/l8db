import { useState } from "react";
import { toast } from "sonner";

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
import { useActiveConnection } from "@/lib/connections";
import { type CreatePolicyRequest, createPolicy } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

const POLICY_COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

export function CreatePolicyDialog({
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
