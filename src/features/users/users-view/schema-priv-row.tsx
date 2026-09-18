import { SCHEMA_PRIVS } from "@/features/users/users-view/constants";
import { PrivCheckbox } from "@/features/users/users-view/priv-checkbox";
import type { PrivilegeChange, SchemaPrivileges } from "@/lib/db";

export function SchemaPrivRow({
  sp,
  roleName,
  pendingChanges,
  onToggle,
}: {
  sp: SchemaPrivileges;
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-1.5 font-mono text-xs">{sp.schema}</td>
      {SCHEMA_PRIVS.map((priv) => {
        const hasPriv = priv === "USAGE" ? sp.usage : sp.create;
        const changeKey = `schema:${sp.schema}:undefined:${priv}`;
        const isPending = pendingChanges.has(changeKey);
        return (
          <td key={priv} className="px-2 py-1.5 text-center">
            <PrivCheckbox
              checked={hasPriv}
              pending={isPending}
              onToggle={() =>
                onToggle({
                  grant: !hasPriv,
                  privilege: priv,
                  object_type: "schema",
                  schema: sp.schema,
                  role_name: roleName,
                })
              }
            />
          </td>
        );
      })}
    </tr>
  );
}
