import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { QueryResult } from "@/lib/db";

export function QueryJsonRows({
  rows,
  columnCount,
  fontSize,
}: {
  rows: QueryResult["rows"] | undefined;
  columnCount: number;
  fontSize: number;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const virtualizer = useVirtualizer({
    count: rows ? rows.length + 2 : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      (index === 0 || index === (rows?.length ?? 0) + 1 ? 1 : columnCount + 3) * fontSize * 1.5,
    overscan: 1,
    initialRect: { width: 700, height: 700 },
  });
  return (
    <pre
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto bg-muted/10 p-4 font-mono"
      style={{ fontSize: `${fontSize / 16}rem`, lineHeight: 1.5, contain: "strict" }}
      data-slot="query-json-rows"
      tabIndex={-1}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {rows &&
          virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const text =
              index === 0
                ? "[\n"
                : index === rows.length + 1
                  ? "]"
                  : `  ${JSON.stringify(rows[index - 1], null, 2).replace(/\n/g, "\n  ")}${index < rows.length ? ",\n" : "\n"}`;
            return (
              <div
                key={virtualRow.key}
                data-index={index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {text}
              </div>
            );
          })}
      </div>
    </pre>
  );
}
