import { ChevronRightIcon } from "lucide-react";
import type { TransactionChange } from "@/lib/transactions";

export function DiffUpdateEntry({ change }: { change: TransactionChange }) {
  const oldVals = change.oldValues ?? {};
  const newVals = change.newValues ?? {};
  const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)])).filter(
    (k) => k !== "__ctid__",
  );

  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        <ChevronRightIcon className="size-3 text-muted-foreground" />
        <span className="font-mono text-[11px] font-semibold text-foreground/80">
          {change.schema}.{change.table}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          ctid {change.ctid}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        {allKeys.map((key) => {
          const raw = oldVals[key];
          const oldStr =
            raw === null || raw === undefined
              ? "NULL"
              : typeof raw === "object"
                ? JSON.stringify(raw)
                : String(raw);
          const newVal = newVals[key];
          const newStr = newVal === null || newVal === undefined ? "NULL" : String(newVal);
          return (
            <div key={key}>
              <div className="flex bg-red-500/[0.07] text-red-600 dark:text-red-400 px-2.5">
                <span className="w-4 shrink-0 select-none text-red-500/60">-</span>
                <span className="text-red-500/70">{key}: </span>
                <span className="ml-1 truncate">{oldStr}</span>
              </div>
              <div className="flex bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400 px-2.5">
                <span className="w-4 shrink-0 select-none text-emerald-500/60">+</span>
                <span className="text-emerald-500/70">{key}: </span>
                <span className="ml-1 truncate">{newStr}</span>
              </div>
            </div>
          );
        })}
        {allKeys.length === 0 && (
          <div className="px-2.5 py-1 text-muted-foreground">Keine sichtbaren Unterschiede</div>
        )}
      </div>
    </div>
  );
}
