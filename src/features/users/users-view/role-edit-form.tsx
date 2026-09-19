import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SwitchRow } from "@/features/users/users-view/switch-row";
import type { EditFormState } from "@/features/users/users-view/types";
import type { RoleInfo } from "@/lib/db";

export function RoleEditForm({
  role,
  state,
  onChange,
  allRoles,
  toggleMembership,
}: {
  role: RoleInfo;
  state: EditFormState;
  onChange: (s: EditFormState) => void;
  allRoles: RoleInfo[];
  toggleMembership: (name: string) => void;
}) {
  const otherRoles = allRoles.filter((r) => r.name !== role.name);

  const effectiveMemberships = new Set<string>();
  for (const r of state.current_member_of) {
    if (!state.revoke_roles.includes(r)) {
      effectiveMemberships.add(r);
    }
  }
  for (const r of state.grant_roles) {
    effectiveMemberships.add(r);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Eigenschaften</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <SwitchRow
            label="Superuser"
            checked={state.superuser}
            onCheckedChange={(v) => onChange({ ...state, superuser: v })}
          />
          <SwitchRow
            label="Login"
            checked={state.can_login}
            onCheckedChange={(v) => onChange({ ...state, can_login: v })}
          />
          <SwitchRow
            label="Create DB"
            checked={state.create_db}
            onCheckedChange={(v) => onChange({ ...state, create_db: v })}
          />
          <SwitchRow
            label="Create Role"
            checked={state.create_role}
            onCheckedChange={(v) => onChange({ ...state, create_role: v })}
          />
          <SwitchRow
            label="Replication"
            checked={state.replication}
            onCheckedChange={(v) => onChange({ ...state, replication: v })}
          />
          <SwitchRow
            label="Bypass RLS"
            checked={state.bypass_rls}
            onCheckedChange={(v) => onChange({ ...state, bypass_rls: v })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Verbindung</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="conn-limit" className="text-xs">
              Connection Limit
            </Label>
            <Input
              id="conn-limit"
              type="number"
              min={-1}
              placeholder="-1 = Unbegrenzt"
              value={state.conn_limit}
              onChange={(e) => onChange({ ...state, conn_limit: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valid-until" className="text-xs">
              Gültig bis
            </Label>
            <Input
              id="valid-until"
              type="datetime-local"
              value={state.valid_until}
              onChange={(e) => onChange({ ...state, valid_until: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Passwort</h3>
        <div className="max-w-xs">
          <Input
            type="password"
            placeholder="Neues Passwort (leer = unverändert)"
            value={state.password}
            onChange={(e) => onChange({ ...state, password: e.target.value })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Mitgliedschaften</h3>
        {otherRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine anderen Rollen vorhanden.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {otherRoles.map((r) => {
              const isMember = effectiveMemberships.has(r.name);
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => toggleMembership(r.name)}
                  className="inline-flex items-center gap-1"
                >
                  <Badge variant={isMember ? "default" : "outline"}>
                    {isMember && <CheckIcon className="size-3" />}
                    {r.name}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
