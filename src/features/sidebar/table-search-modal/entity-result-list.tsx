import { useVirtualizer } from "@tanstack/react-virtual";
import { ColumnsIcon, EyeIcon, TableIcon } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MatchedEntity } from "./types";

interface EntityResultListProps {
  filteredEntities: MatchedEntity[];
  selectedEntity: MatchedEntity | null;
  onSelect: (entity: MatchedEntity) => void;
  onOpenDirect: (entity: MatchedEntity) => void;
}

export function EntityResultList({
  filteredEntities,
  selectedEntity,
  onSelect,
  onOpenDirect,
}: EntityResultListProps) {
  const counts = useMemo(() => {
    let tables = 0;
    for (const entity of filteredEntities) if (entity.type === "table") tables++;
    return { tables, views: filteredEntities.length - tables };
  }, [filteredEntities]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const estimateSize = useCallback(
    (index: number) => {
      const count = filteredEntities[index]?.matchingColumns.length ?? 0;
      return 28 + (count > 0 ? 4 + Math.min(count, 3) * 19 + (count > 3 ? 19 : 0) : 0);
    },
    [filteredEntities],
  );
  const getItemKey = useCallback(
    (index: number) => {
      const entity = filteredEntities[index];
      return `${entity.type}:${entity.schema}.${entity.name}`;
    },
    [filteredEntities],
  );
  const virtualizer = useVirtualizer({
    count: filteredEntities.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 8,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });
  const focusResult = (index: number) => {
    if (index < 0 || index >= filteredEntities.length) return;
    const focus = (attempts: number) => {
      const button = scrollRef.current?.querySelector<HTMLButtonElement>(
        `[data-index="${index}"] button`,
      );
      if (button) button.focus();
      else if (attempts > 0) requestAnimationFrame(() => focus(attempts - 1));
    };
    const visible = scrollRef.current?.querySelector(`[data-index="${index}"]`);
    if (visible) {
      focus(0);
      return;
    }
    virtualizer.scrollToIndex(index, { align: "auto" });
    requestAnimationFrame(() => focus(20));
  };

  return (
    <div className="flex min-h-0 w-1/2 flex-col border-r">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {filteredEntities.length} Ergebnis{filteredEntities.length !== 1 ? "se" : ""}
        </span>
        {counts.tables > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            <TableIcon className="size-2.5" />
            {counts.tables}
          </Badge>
        )}
        {counts.views > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            <EyeIcon className="size-2.5" />
            {counts.views}
          </Badge>
        )}
      </div>
      <section
        ref={scrollRef}
        aria-label="Suchergebnisse"
        className="min-h-0 flex-1 overflow-auto"
        style={{ contain: "strict" }}
      >
        {filteredEntities.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">Keine Treffer</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entity = filteredEntities[item.index];
              const isSelected =
                selectedEntity?.schema === entity.schema &&
                selectedEntity?.name === entity.name &&
                selectedEntity?.type === entity.type;
              return (
                <div
                  key={item.key}
                  ref={entity.matchingColumns.length > 0 ? virtualizer.measureElement : undefined}
                  data-index={item.index}
                  className="absolute left-0 w-full"
                  style={{ top: item.start }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(entity)}
                    onDoubleClick={() => onOpenDirect(entity)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === "ArrowDown"
                          ? item.index + 1
                          : event.key === "ArrowUp"
                            ? item.index - 1
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? filteredEntities.length - 1
                                : null;
                      if (next === null) return;
                      event.preventDefault();
                      focusResult(next);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/80",
                      isSelected && "bg-muted",
                    )}
                  >
                    {entity.type === "table" ? (
                      <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {entity.schema}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{entity.name}</span>
                  </button>
                  {entity.matchingColumns.length > 0 && (
                    <div className="ml-7 border-l border-border/40 py-0.5 pl-2">
                      {entity.matchingColumns.slice(0, 3).map((col) => (
                        <div
                          key={col}
                          className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-muted-foreground"
                        >
                          <ColumnsIcon className="size-2.5 shrink-0" />
                          <span className="truncate">{col}</span>
                        </div>
                      ))}
                      {entity.matchingColumns.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground/60">
                          +{entity.matchingColumns.length - 3} weitere
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
