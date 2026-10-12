import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState } from "react";

import type { DatabaseKind } from "@/lib/db";
import type { TargetRun } from "@/lib/multi-target";
import { observeVirtualScrollRect } from "@/lib/observe-virtual-scroll-rect";
import { measureVirtualItem } from "@/lib/virtual-item-measurement";

import { MultiTargetResultRow } from "./multi-target-result-row";

export interface MultiTargetResultItem {
  id: string;
  label: string;
  production: boolean;
}

interface MultiTargetResultsProps {
  items: MultiTargetResultItem[];
  runs: Record<string, TargetRun>;
  kind?: DatabaseKind;
  onCancel: (id: string) => void;
}

export function MultiTargetResults({ items, runs, kind, onCancel }: MultiTargetResultsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const getItemKey = useCallback((index: number) => items[index]?.id ?? index, [items]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.id === expanded ? 380 : 46),
    measureElement: measureVirtualItem,
    observeElementRect: observeVirtualScrollRect,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    getItemKey,
    overscan: 4,
    initialRect: { width: 900, height: 560 },
  });
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-multi-target-results>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <MultiTargetResultRow
                label={item.label}
                run={runs[item.id]}
                production={item.production}
                expanded={expanded === item.id}
                kind={kind}
                onToggle={() => setExpanded((current) => (current === item.id ? null : item.id))}
                onCancel={() => onCancel(item.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
