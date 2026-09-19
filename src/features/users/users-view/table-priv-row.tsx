import { Badge } from "@/components/ui/badge";
import { TABLE_PRIVS } from "@/features/users/users-view/constants";
import { PrivCheckbox } from "@/features/users/users-view/priv-checkbox";
import { privKey } from "@/features/users/users-view/priv-key";
import type { PrivilegeChange, TablePrivileges } from "@/lib/db";
import { cn } from "@/lib/utils";

export function TablePrivRow({
  tp,
  roleName,
  pendingChanges,
  onToggle,
}: {
  tp: TablePrivileges;
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  const allGranted = TABLE_PRIVS.every((p) => privKey(tp, p));

  const handleToggleAll = () => {
    onToggle({
      grant: !allGranted,
      privilege: "ALL PRIVILEGES",
      object_type: tp.object_type,
      schema: tp.schema,
      table: tp.table,
      role_name: roleName,
    });
  };

  return (
    <tr className="border-t hover:bg-muted/20 transition-colors">
      <td className="px-3 py-1 font-mono text-xs truncate max-w-[220px]">{tp.table}</td>
      <td className="px-2 py-1">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0",
            tp.object_type === "view" && "border-cyan-500/30 text-cyan-600 dark:text-cyan-400",
            tp.object_type === "sequence" &&
              "border-amber-500/30 text-amber-600 dark:text-amber-400",
          )}
        >
          {tp.object_type === "materialized_view" ? "mview" : tp.object_type}
        </Badge>
      </td>
      {TABLE_PRIVS.map((priv) => {
        const hasPriv = privKey(tp, priv);
        const changeKey = `${tp.object_type}:${tp.schema}:${tp.table}:${priv}`;
        const isPending = pendingChanges.has(changeKey);
        return (
          <td key={priv} className="px-1 py-1 text-center">
            <PrivCheckbox
              checked={hasPriv}
              pending={isPending}
              onToggle={() =>
                onToggle({
                  grant: !hasPriv,
                  privilege: priv,
                  object_type: tp.object_type,
                  schema: tp.schema,
                  table: tp.table,
                  role_name: roleName,
                })
              }
            />
          </td>
        );
      })}
      <td className="px-1 py-1 text-center">
        <PrivCheckbox checked={allGranted} pending={false} onToggle={handleToggleAll} />
      </td>
    </tr>
  );
}
