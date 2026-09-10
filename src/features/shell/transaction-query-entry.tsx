import { TerminalIcon } from "lucide-react";
import type { TransactionChange } from "@/lib/transactions";

export function DiffQueryEntry({ change }: { change: TransactionChange }) {
  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        <TerminalIcon className="size-3 text-muted-foreground" />
        <span className="font-mono text-[11px] font-semibold text-foreground/80">SQL Query</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(change.timestamp).toLocaleTimeString("de-DE")}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        <div className="bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5">
          <span className="mr-1 select-none text-emerald-500/60">+</span>
          <span className="break-all">{change.sql}</span>
        </div>
        {change.rowsAffected != null && (
          <div className="px-2.5 py-0.5 text-muted-foreground">
            <span className="mr-1 select-none opacity-0">+</span>
            {change.rowsAffected} Zeile(n) betroffen
          </div>
        )}
      </div>
    </div>
  );
}
