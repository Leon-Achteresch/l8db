import { useVirtualizer } from "@tanstack/react-virtual";
import { HistoryIcon } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import { formatDateTime, formatDuration, triggerLabel } from "@/lib/automation/format";
import type { RunSummary } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./status-icon";

interface Props {
  runs: RunSummary[];
  selectedId: string | null;
  loaded: boolean;
  now: number;
  onSelect: (id: string) => void;
}

const ROW = 56;

export function RunList({ runs, selectedId, loaded, now, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: runs.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 8,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = runs.findIndex((run) => run.id === selectedId);
    const next =
      runs[Math.max(0, Math.min(runs.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    onSelect(next.id);
    virtualizer.scrollToIndex(runs.indexOf(next), { align: "auto" });
  };

  if (loaded && runs.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
          <HistoryIcon aria-hidden className="size-4" />
        </span>
        <p className="text-sm font-medium">Keine Läufe</p>
        <p className="text-xs text-pretty text-muted-foreground">
          Sobald ein Task läuft, erscheint er hier mit allen Schritten und Logs.
        </p>
      </div>
    );

  return (
    <div
      ref={scroller}
      role="listbox"
      aria-label="Läufe"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="automation-run-list"
      className="h-full overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const run = runs[item.index];
          const selected = run.id === selectedId;
          const duration =
            run.status === "running"
              ? formatDuration(now - new Date(run.startedAt).getTime())
              : formatDuration(run.durationMs);
          return (
            <div
              key={run.id}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              data-run-id={run.id}
              onClick={() => onSelect(run.id)}
              onKeyDown={(event) => event.key === "Enter" && onSelect(run.id)}
              className={cn(
                "absolute inset-x-0 top-0 flex cursor-default items-center gap-3 border-b border-border/60 px-4 transition-colors",
                selected ? "bg-accent" : "hover:bg-muted/60",
              )}
              style={{ height: ROW, transform: `translateY(${item.start}px)` }}
            >
              <StatusIcon status={run.status} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span title={run.taskName} className="truncate text-[13px] font-medium">
                  {run.taskName}
                </span>
                <span className="truncate text-[11px] tabular-nums text-muted-foreground">
                  {formatDateTime(run.startedAt)}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    run.status === "running" ? "text-primary" : "text-foreground/80",
                  )}
                >
                  {duration}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {triggerLabel(run.trigger)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
