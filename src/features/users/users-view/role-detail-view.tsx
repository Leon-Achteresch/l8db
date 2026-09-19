import { Badge } from "@/components/ui/badge";
import { PrivilegesPanel } from "@/features/users/users-view/privileges-panel";
import { PropertyRow } from "@/features/users/users-view/property-row";
import type { RoleInfo } from "@/lib/db";

export function RoleDetailView({ role }: { role: RoleInfo }) {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Eigenschaften</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <PropertyRow label="Superuser" value={role.superuser} />
            <PropertyRow label="Login" value={role.can_login} />
            <PropertyRow label="Create DB" value={role.create_db} />
            <PropertyRow label="Create Role" value={role.create_role} />
            <PropertyRow label="Replication" value={role.replication} />
            <PropertyRow label="Bypass RLS" value={role.bypass_rls} />
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Connection Limit</span>
              <span className="font-mono">
                {role.conn_limit === -1 ? "Unbegrenzt" : role.conn_limit}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Gültig bis</span>
              <span className="font-mono">{role.valid_until ?? "Unbegrenzt"}</span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mitglied von</h3>
          {role.member_of.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Mitgliedschaften.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {role.member_of.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mitglieder</h3>
          {role.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Mitglieder.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {role.members.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">OID</h3>
          <p className="text-sm font-mono text-muted-foreground">{role.oid}</p>
        </section>
      </div>

      <PrivilegesPanel roleName={role.name} />
    </div>
  );
}
