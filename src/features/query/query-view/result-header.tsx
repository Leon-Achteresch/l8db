import type { ReactNode } from "react";

import type { QueryResult } from "@/lib/db";
import { cn } from "@/lib/utils";

interface ResultHeaderProps {
  isRunning: boolean;
  error: string | null;
  result: QueryResult | null;
  statusText: string | null;
  actions: ReactNode;
}

export function ResultHeader({ isRunning, error, result, statusText, actions }: ResultHeaderProps) {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-1 text-xs">
      <span className="font-medium">Ergebnisse</span>
      <span
        role="status"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px]",
          isRunning
            ? "border-primary/30 bg-primary/10 text-primary"
            : error
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-background/60 text-muted-foreground",
        )}
      >
        <span className={cn("size-1.5 rounded-full bg-current", isRunning && "animate-pulse")} />
        {isRunning
          ? "Wird ausgeführt"
          : error
            ? "Fehlgeschlagen"
            : result
              ? "Abgeschlossen"
              : "Bereit"}
      </span>
      {statusText && (
        <span className="min-w-0 truncate text-[10px] tabular-nums text-muted-foreground">
          {statusText}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}
