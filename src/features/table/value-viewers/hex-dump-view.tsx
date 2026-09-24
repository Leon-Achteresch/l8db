import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { hexDumpLine } from "@/lib/value-viewers/binary";

const LINE_HEIGHT = 18;
const WIDTH = 16;

export function HexDumpView({ bytes }: { bytes: Uint8Array }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = Math.ceil(bytes.length / WIDTH);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  });
  if (!bytes.length)
    return <p className="p-4 text-xs text-muted-foreground italic">Keine Bytes (leerer Wert)</p>;
  return (
    <div
      ref={scrollRef}
      data-testid="hex-dump"
      className="h-[45vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 font-mono text-xs shadow-inner"
    >
      <div className="sticky top-0 z-10 flex gap-4 border-b border-border/60 bg-muted px-3 py-1 text-muted-foreground">
        <span className="w-[8ch]">Offset</span>
        <span className="w-[48ch]">Hex</span>
        <span>ASCII</span>
      </div>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = hexDumpLine(bytes, item.index * WIDTH, WIDTH);
          return (
            <div
              key={item.key}
              className="absolute left-0 flex gap-4 whitespace-pre px-3"
              style={{ top: item.start, height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
            >
              <span className="w-[8ch] text-muted-foreground">{line.offset}</span>
              <span className="w-[48ch] text-foreground">{line.hex}</span>
              <span className="text-emerald-700 dark:text-emerald-400">{line.ascii}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
