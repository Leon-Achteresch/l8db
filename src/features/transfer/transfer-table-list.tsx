import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";

const ROW = 28;
const HEIGHT = 288;

export function TransferTableList({
  schema,
  names,
  chosen,
  onToggle,
}: {
  schema: string;
  names: string[];
  chosen: Set<string>;
  onToggle: (name: string) => void;
}) {
  const scrollRef = useRef<HTMLFieldSetElement>(null);
  const virtualizer = useVirtualizer({
    count: names.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 8,
    initialRect: { width: HEIGHT, height: HEIGHT },
    useFlushSync: false,
  });
  return (
    <fieldset
      ref={scrollRef}
      aria-label={`Tabellen aus ${schema}`}
      className="min-w-0 overflow-y-auto"
      style={{ height: Math.min(HEIGHT, names.length * ROW), contain: "strict" }}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const name = names[item.index];
          const id = `transfer-table-${schema}-${item.index}`;
          return (
            <label
              key={name}
              htmlFor={id}
              data-table={name}
              className="absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"
              style={{ height: ROW, transform: `translateY(${item.start}px)` }}
            >
              <Checkbox id={id} checked={chosen.has(name)} onCheckedChange={() => onToggle(name)} />
              <span className="truncate font-mono text-xs">{name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
