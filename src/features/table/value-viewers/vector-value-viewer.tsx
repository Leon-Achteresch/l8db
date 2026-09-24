import { useVirtualizer } from "@tanstack/react-virtual";
import { CopyIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { type ParsedVector, vectorStats } from "@/lib/value-viewers/vector";
import { VectorCharts } from "./vector-charts";

const PER_ROW = 8;
const ROW_HEIGHT = 18;

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs < 1e-4 || abs >= 1e6) return value.toExponential(3);
  return String(Number(value.toPrecision(6)));
}

export function VectorValueViewer({ vector }: { vector: ParsedVector }) {
  const stats = useMemo(() => vectorStats(vector.values), [vector]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Math.ceil(vector.dims / PER_ROW);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });
  const facts: [string, string][] = [
    ["Dimensionen", vector.dims.toLocaleString("de-DE")],
    ["Norm (L2)", formatValue(stats.norm)],
    ["Min", formatValue(stats.min)],
    ["Max", formatValue(stats.max)],
    ["Mittelwert", formatValue(stats.mean)],
    ["≠ 0", stats.nonZero.toLocaleString("de-DE")],
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <dl
          className="grid grid-cols-3 gap-x-5 gap-y-1 text-xs sm:grid-cols-6"
          data-testid="vector-stats"
        >
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await copyText(`[${Array.from(vector.values).join(",")}]`);
            toast.success("Vektor kopiert");
          }}
        >
          <CopyIcon className="size-3.5" />
          Als Array kopieren
        </Button>
      </div>
      {vector.source === "float32" && (
        <p className="text-[11px] text-muted-foreground">
          Binärwert als Little-Endian-float32-Folge interpretiert.
        </p>
      )}
      <VectorCharts values={vector.values} min={stats.min} max={stats.max} />
      <div
        ref={scrollRef}
        className="h-[30vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 font-mono text-xs shadow-inner"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const start = item.index * PER_ROW;
            const cells: string[] = [];
            for (let i = start; i < Math.min(vector.dims, start + PER_ROW); i++) {
              cells.push(formatValue(vector.values[i]).padStart(10));
            }
            return (
              <div
                key={item.key}
                className="absolute left-0 flex gap-3 whitespace-pre px-3"
                style={{ top: item.start, height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
              >
                <span className="w-[6ch] text-right text-muted-foreground">
                  {vector.sparse ? start + 1 : start}
                </span>
                <span className="tabular-nums">{cells.join(" ")}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
