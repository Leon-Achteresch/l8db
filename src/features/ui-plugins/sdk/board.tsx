import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";

export function Board<T>({
  columns,
  render,
  limit = 50,
}: {
  columns: readonly { id: string; label: string; tone?: Tone; items: readonly T[] }[];
  render: (item: T) => ReactNode;
  limit?: number;
}) {
  const max = Math.max(1, Math.min(500, Math.trunc(limit) || 50));
  return (
    <div className="flex min-h-0 min-w-0 gap-3 overflow-x-auto pb-1 font-sans">
      {(Array.isArray(columns) ? columns.slice(0, 20) : []).map((column) => {
        const items: readonly T[] = Array.isArray(column.items) ? column.items : [];
        return (
          <section
            key={column.id}
            data-board-column={column.id}
            className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
          >
            <header className="flex items-center gap-1.5 px-1 text-xs font-semibold">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: toneColor(column.tone) }}
              />
              <span className="truncate">{column.label}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{items.length}</span>
            </header>
            {items.slice(0, max).map((item, index) => (
              <div
                key={index}
                className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-card p-2 text-sm shadow-xs"
              >
                {render(item)}
              </div>
            ))}
            {items.length > max && (
              <p className="px-1 text-xs text-muted-foreground">+ {items.length - max} weitere</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
