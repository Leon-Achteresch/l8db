import { useQueryClient } from "@tanstack/react-query";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { SCHEMA_PRIVS } from "@/features/users/users-view/constants";
import { SchemaPrivRow } from "@/features/users/users-view/schema-priv-row";
import { SchemaTableGroup } from "@/features/users/users-view/schema-table-group";
import { useActiveConnection } from "@/lib/connections";
import { modifyPrivilege, type PrivilegeChange, type TablePrivileges } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useRolePrivilegesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

export function PrivilegesPanel({ roleName }: { roleName: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: privileges, isLoading, isError, error } = useRolePrivilegesQuery(roleName);

  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());

  const schemaGroups = useMemo(() => {
    if (!privileges) return [];
    const map = new Map<string, TablePrivileges[]>();
    for (const tp of privileges.tables) {
      const list = map.get(tp.schema) ?? [];
      list.push(tp);
      map.set(tp.schema, list);
    }
    return Array.from(map.entries()).map(([schema, tables]) => ({
      schema,
      tables,
    }));
  }, [privileges]);

  const handleToggle = useCallback(
    async (change: PrivilegeChange) => {
      if (!connection) return;
      const changeKey = `${change.object_type}:${change.schema}:${change.table}:${change.privilege}`;
      setPendingChanges((prev) => new Set(prev).add(changeKey));
      try {
        await modifyPrivilege(
          connection.kind,
          effectiveConnectionString(connection),
          change,
          database ?? undefined,
        );
        await queryClient.invalidateQueries({
          queryKey: ["role-privileges"],
        });
      } catch (e) {
        toast.error(String(e));
      } finally {
        setPendingChanges((prev) => {
          const next = new Set(prev);
          next.delete(changeKey);
          return next;
        });
      }
    },
    [connection, database, queryClient],
  );

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Rechte</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Lade Rechte…
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Rechte</h3>
        <p className="text-sm text-destructive">{String(error)}</p>
      </section>
    );
  }

  if (!privileges) return null;

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Rechte</h3>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Schema-Rechte
        </h4>
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-xs">Schema</th>
                {SCHEMA_PRIVS.map((p) => (
                  <th key={p} className="w-20 px-2 py-2 text-center font-medium text-xs">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {privileges.schemas.map((sp) => (
                <SchemaPrivRow
                  key={sp.schema}
                  sp={sp}
                  roleName={roleName}
                  pendingChanges={pendingChanges}
                  onToggle={handleToggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tabellen- & View-Rechte
        </h4>
        {schemaGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Objekte.</p>
        ) : (
          <div className="space-y-2">
            {schemaGroups.map((group) => (
              <SchemaTableGroup
                key={group.schema}
                schema={group.schema}
                tables={group.tables}
                roleName={roleName}
                pendingChanges={pendingChanges}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
