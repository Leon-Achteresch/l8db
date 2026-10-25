import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { ColumnMask } from "@/lib/masking";
import type { ResultChange } from "@/lib/result-compare";
import { cn } from "@/lib/utils";
import { ResultCompareEntry } from "./result-compare-entry";
import { CHANGE_TONE } from "./tone";

const ROW_HEIGHT = 32;

export function ResultCompareList({
  changes,
  selectedId,
  onSelect,
  keyColumns,
  columns,
  masks,
}: {
  changes: ResultChange[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  keyColumns: string[];
  columns: string[];
  masks: ColumnMask[];
}) {
  const baseId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: changes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 600, height: 320 },
  });
  const selectedIndex = changes.findIndex((change) => change.id === selectedId);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (changes.length === 0) return;
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 320) / ROW_HEIGHT));
    const from = Math.max(0, selectedIndex);
    const next =
      event.key === "ArrowDown"
        ? Math.min(changes.length - 1, selectedIndex + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, from - 1)
          : event.key === "PageDown"
            ? Math.min(changes.length - 1, from + page)
            : event.key === "PageUp"
              ? Math.max(0, from - page)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? changes.length - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(changes[next].id);
  };

  return (
    <div
      ref={scrollRef}
      role="listbox"
      tabIndex={0}
      aria-label="Unterschiede zum vorherigen Lauf"
      aria-activedescendant={selectedIndex >= 0 ? `${baseId}-${selectedIndex}` : undefined}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const change = changes[item.index];
          const selected = item.index === selectedIndex;
          return (
            <div
              key={change.id}
              id={`${baseId}-${item.index}`}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => onSelect(change.id)}
              className={cn(
                "absolute inset-x-0 flex cursor-pointer items-center gap-2 border-b border-l-2 border-b-border/40 pr-3 pl-2.5 text-xs transition-colors",
                selected
                  ? cn(CHANGE_TONE[change.kind].edge, "bg-accent")
                  : "border-l-transparent hover:bg-muted/60",
              )}
              style={{ top: item.start, height: ROW_HEIGHT }}
            >
              <ResultCompareEntry
                change={change}
                keyColumns={keyColumns}
                columns={columns}
                masks={masks}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
