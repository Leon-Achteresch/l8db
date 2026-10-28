import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type ConvexExecution,
  formatDuration,
  formatLogTime,
  LEVEL_CLASS,
  type LogLevel,
  type LogRow,
  visibleLines,
} from "./convex-logs-buffer";

const ROW_HEIGHT = 32;

function statusClass(execution: ConvexExecution) {
  if (!execution.completed) return "bg-muted-foreground/50";
  return execution.success ? "bg-emerald-500" : "bg-destructive";
}

export function ConvexLogsList({
  rows,
  levels,
  onSelect,
}: {
  rows: LogRow[];
  levels: LogLevel[];
  onSelect: (execution: ConvexExecution) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <div ref={scrollRef} className="h-[52vh] overflow-auto rounded-xl border bg-background">
      <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
        {items.map((item) => {
          const row = rows[item.index];
          if (row.type === "group") {
            const failed = row.executions.some((execution) => execution.success === false);
            return (
              <div
                key={`group-${row.requestId}`}
                style={{ height: ROW_HEIGHT }}
                className="flex items-center gap-2 border-b bg-muted/40 px-3 font-mono text-[11px] text-muted-foreground"
              >
                <span className="font-semibold text-foreground">Request {row.requestId}</span>
                <span>{row.executions.length} Ausführungen</span>
                {failed && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                    Fehler
                  </Badge>
                )}
              </div>
            );
          }
          const { execution, nested } = row;
          const lines = visibleLines(execution, levels);
          const last = lines.at(-1);
          return (
            <button
              key={execution.key}
              type="button"
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect(execution)}
              className={cn(
                "flex w-full items-center gap-3 border-b px-3 text-left font-mono text-xs hover:bg-muted/60",
                nested && "pl-7",
              )}
            >
              <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                {formatLogTime(execution.timestampMs)}
              </span>
              <span
                className={cn("size-2 shrink-0 rounded-full", statusClass(execution))}
                title={execution.completed ? (execution.success ? "Erfolg" : "Fehler") : "Läuft"}
              />
              <span className="w-16 shrink-0 text-[10px] text-muted-foreground uppercase">
                {execution.udfType}
              </span>
              <span className="w-56 shrink-0 truncate" title={execution.identifier}>
                {execution.identifier}
              </span>
              <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
                {formatDuration(execution.executionTimeMs)}
              </span>
              {execution.cached && (
                <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                  Cache
                </Badge>
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  execution.error ? "text-destructive" : last && LEVEL_CLASS[last.level],
                )}
              >
                {execution.error
                  ? execution.error.split("\n")[0]
                  : last
                    ? `[${last.level}] ${last.message}`
                    : ""}
              </span>
              {lines.length > 1 && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {lines.length} Zeilen
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
