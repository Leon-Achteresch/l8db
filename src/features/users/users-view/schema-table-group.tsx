import { ChevronDown, ChevronRight } from "lucide";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TABLE_PRIV_SHORT, TABLE_PRIVS } from "@/features/users/users-view/constants";
import { PrivBar } from "@/features/users/users-view/priv-bar";
import { privKey } from "@/features/users/users-view/priv-key";
import { TablePrivRow } from "@/features/users/users-view/table-priv-row";
import type { PrivilegeChange, TablePrivileges } from "@/lib/db";
import { SPRING_LAYOUT } from "@/lib/ease";

export function SchemaTableGroup({
  schema,
  tables,
  roleName,
  pendingChanges,
  onToggle,
}: {
  schema: string;
  tables: TablePrivileges[];
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const grantedCount = useMemo(() => {
    let count = 0;
    for (const tp of tables) {
      for (const priv of TABLE_PRIVS) {
        if (privKey(tp, priv)) count++;
      }
    }
    return count;
  }, [tables]);

  const totalCount = tables.length * TABLE_PRIVS.length;

  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="rounded-lg border">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <MorphIcon
          icon={collapsed ? ChevronRight : ChevronDown}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="text-xs font-medium font-mono">{schema}</span>
        <span className="text-xs text-muted-foreground">
          {tables.length} {tables.length === 1 ? "Objekt" : "Objekte"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {grantedCount}/{totalCount}
        </span>
        <PrivBar granted={grantedCount} total={totalCount} />
      </button>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t bg-muted/30">
                <th className="px-3 py-1.5 text-left font-medium text-xs min-w-[180px]">Objekt</th>
                <th className="px-2 py-1.5 text-left font-medium text-xs w-16">Typ</th>
                {TABLE_PRIVS.map((p) => (
                  <TooltipProvider key={p} delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <th className="w-12 px-1 py-1.5 text-center font-medium text-xs cursor-help">
                          {TABLE_PRIV_SHORT[p]}
                        </th>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{p}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
                <th className="w-12 px-1 py-1.5 text-center font-medium text-xs">ALL</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((tp) => (
                <TablePrivRow
                  key={`${tp.schema}.${tp.table}`}
                  tp={tp}
                  roleName={roleName}
                  pendingChanges={pendingChanges}
                  onToggle={onToggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
