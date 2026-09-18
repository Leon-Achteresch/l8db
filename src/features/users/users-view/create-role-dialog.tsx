import { useQueryClient } from "@tanstack/react-query";

import { useNavigate } from "@tanstack/react-router";
import { Loader, Plus } from "lucide";
import { CheckIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useState } from "react";
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
import { defaultCreateForm } from "@/features/users/users-view/constants";
import { SwitchRow } from "@/features/users/users-view/switch-row";
import type { CreateFormState } from "@/features/users/users-view/types";
import { useActiveConnection } from "@/lib/connections";
import { type CreateRoleOptions, createRole, type RoleInfo } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

export function CreateRoleDialog({
  open,
  onOpenChange,
  allRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allRoles: RoleInfo[];
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateFormState>(defaultCreateForm);

  const handleCreate = useCallback(async () => {
    if (!connection || !form.name.trim()) return;
    setCreating(true);
    try {
      const options: CreateRoleOptions = {
        name: form.name.trim(),
        password: form.password || undefined,
        superuser: form.superuser,
        can_login: form.can_login,
        create_db: form.create_db,
        create_role: form.create_role,
        replication: form.replication,
        bypass_rls: form.bypass_rls,
        conn_limit: form.conn_limit !== "" ? Number(form.conn_limit) : undefined,
        valid_until: form.valid_until || undefined,
        member_of: form.member_of,
      };
      await createRole(
        connection.kind,
        effectiveConnectionString(connection),
        options,
        database ?? undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast.success(`Rolle "${form.name}" erstellt`);
      onOpenChange(false);
      setForm(defaultCreateForm);
      navigate({ to: "/users/$name", params: { name: form.name.trim() } });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  }, [connection, database, form, queryClient, onOpenChange, navigate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue Rolle erstellen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-name" className="text-xs">
              Name
            </Label>
            <Input
              id="create-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Rollenname"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-password" className="text-xs">
              Passwort
            </Label>
            <Input
              id="create-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <SwitchRow
              label="Login"
              checked={form.can_login}
              onCheckedChange={(v) => setForm({ ...form, can_login: v })}
            />
            <SwitchRow
              label="Superuser"
              checked={form.superuser}
              onCheckedChange={(v) => setForm({ ...form, superuser: v })}
            />
            <SwitchRow
              label="Create DB"
              checked={form.create_db}
              onCheckedChange={(v) => setForm({ ...form, create_db: v })}
            />
            <SwitchRow
              label="Create Role"
              checked={form.create_role}
              onCheckedChange={(v) => setForm({ ...form, create_role: v })}
            />
            <SwitchRow
              label="Replication"
              checked={form.replication}
              onCheckedChange={(v) => setForm({ ...form, replication: v })}
            />
            <SwitchRow
              label="Bypass RLS"
              checked={form.bypass_rls}
              onCheckedChange={(v) => setForm({ ...form, bypass_rls: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-conn-limit" className="text-xs">
                Connection Limit
              </Label>
              <Input
                id="create-conn-limit"
                type="number"
                min={-1}
                placeholder="-1 = Unbegrenzt"
                value={form.conn_limit}
                onChange={(e) => setForm({ ...form, conn_limit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-valid-until" className="text-xs">
                Gültig bis
              </Label>
              <Input
                id="create-valid-until"
                type="datetime-local"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              />
            </div>
          </div>
          {allRoles.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Mitglied von</Label>
              <div className="flex flex-wrap gap-1.5">
                {allRoles.map((r) => {
                  const selected = form.member_of.includes(r.name);
                  return (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          member_of: selected
                            ? form.member_of.filter((n) => n !== r.name)
                            : [...form.member_of, r.name],
                        })
                      }
                    >
                      <Badge variant={selected ? "default" : "outline"}>
                        {selected && <CheckIcon className="size-3" />}
                        {r.name}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setForm(defaultCreateForm);
            }}
          >
            Abbrechen
          </Button>
          <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
            <MorphIcon
              icon={creating ? Loader : Plus}
              className={cn("size-4", creating && "animate-spin")}
            />
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
