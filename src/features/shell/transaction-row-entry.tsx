import { PlusIcon, Trash2Icon } from "lucide-react";
import type { TransactionChange } from "@/lib/transactions";
import { cn } from "@/lib/utils";

function formatValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

export function DiffRowEntry({ change }: { change: TransactionChange }) {
  const isInsert = change.type === "insert";
  const values = isInsert ? (change.rowValues ?? {}) : (change.oldValues ?? {});
  const keys = Object.keys(values).filter((k) => k !== "__ctid__");

  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        {isInsert ? (
          <PlusIcon className="size-3 text-emerald-500" />
        ) : (
          <Trash2Icon className="size-3 text-red-500" />
        )}
        <span className="font-mono text-[11px] font-semibold text-foreground/80">
          {change.schema}.{change.table}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {isInsert ? "INSERT" : "DELETE"}
          {change.ctid ? ` · ctid ${change.ctid}` : ""}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        {keys.map((key) => (
          <div
            key={key}
            className={cn(
              "flex px-2.5",
              isInsert
                ? "bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/[0.07] text-red-600 dark:text-red-400",
            )}
          >
            <span
              className={cn(
                "w-4 shrink-0 select-none",
                isInsert ? "text-emerald-500/60" : "text-red-500/60",
              )}
            >
              {isInsert ? "+" : "-"}
            </span>
            <span className={isInsert ? "text-emerald-500/70" : "text-red-500/70"}>{key}: </span>
            <span className="ml-1 truncate">{formatValue(values[key])}</span>
          </div>
        ))}
        {keys.length === 0 && (
          <div className="px-2.5 py-1 text-muted-foreground">
            {isInsert ? "Standardwerte" : "Keine Werte"}
          </div>
        )}
      </div>
    </div>
  );
}
