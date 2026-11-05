import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";

const ROW = 28;
const HEIGHT = 288;

export interface TransferPickItem {
  key: string;
  name: string;
  type: string;
  header?: boolean;
}

export function TransferTableList({
  schema,
  items,
  chosen,
  onToggle,
}: {
  schema: string;
  items: TransferPickItem[];
  chosen: Set<string>;
  onToggle: (key: string) => void;
}) {
  const scrollRef = useRef<HTMLFieldSetElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 8,
    initialRect: { width: HEIGHT, height: HEIGHT },
    useFlushSync: false,
  });
  return (
    <fieldset
      ref={scrollRef}
      aria-label={`Objekte aus ${schema}`}
      className="min-w-0 overflow-y-auto"
      style={{ height: Math.min(HEIGHT, items.length * ROW), contain: "strict" }}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          const style = { height: ROW, transform: `translateY(${row.start}px)` };
          if (item.header)
            return (
              <div
                key={item.key}
                className="absolute top-0 left-0 flex w-full items-end px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
                style={style}
              >
                {item.name}
              </div>
            );
          const id = `transfer-object-${schema}-${row.index}`;
          return (
            <label
              key={item.key}
              htmlFor={id}
              data-table={item.type === "table" ? item.name : undefined}
              data-object={item.key}
              className="absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"
              style={style}
            >
              <Checkbox
                id={id}
                checked={chosen.has(item.key)}
                onCheckedChange={() => onToggle(item.key)}
              />
              <span className="truncate font-mono text-xs">{item.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
