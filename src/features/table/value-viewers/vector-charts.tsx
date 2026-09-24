import { useMemo } from "react";
import { vectorHistogram } from "@/lib/value-viewers/vector";

const SPARK_W = 480;
const SPARK_H = 72;
const HIST_W = 240;
const BUCKETS = 32;

export function VectorCharts({
  values,
  min,
  max,
}: {
  values: Float64Array;
  min: number;
  max: number;
}) {
  const spark = useMemo(() => {
    const n = values.length;
    if (!n) return "";
    const span = max - min || 1;
    const buckets = Math.min(n, SPARK_W);
    const y = (v: number) => SPARK_H - 2 - ((v - min) / span) * (SPARK_H - 4);
    let d = "";
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor((b * n) / buckets);
      const end = Math.max(start + 1, Math.floor(((b + 1) * n) / buckets));
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo)) continue;
      const x = buckets === 1 ? SPARK_W / 2 : (b / (buckets - 1)) * SPARK_W;
      d += `${d ? "L" : "M"}${x.toFixed(1)} ${y(hi).toFixed(1)}`;
      if (lo !== hi) d += `L${x.toFixed(1)} ${y(lo).toFixed(1)}`;
    }
    return d;
  }, [values, min, max]);
  const histogram = useMemo(() => vectorHistogram(values, BUCKETS), [values]);
  const peak = Math.max(1, ...histogram);
  const zeroY = max > 0 && min < 0 ? SPARK_H - 2 - ((0 - min) / (max - min)) * (SPARK_H - 4) : null;
  return (
    <div className="grid grid-cols-[2fr_1fr] gap-3">
      <figure className="flex flex-col gap-1">
        <svg
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className="h-18 w-full rounded-md border border-border/80 bg-muted/30 text-primary"
          role="img"
          aria-label="Werteverlauf"
        >
          {zeroY !== null && (
            <line
              x1={0}
              x2={SPARK_W}
              y1={zeroY}
              y2={zeroY}
              className="stroke-border"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={spark}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <figcaption className="text-[11px] text-muted-foreground">Werte nach Index</figcaption>
      </figure>
      <figure className="flex flex-col gap-1">
        <svg
          viewBox={`0 0 ${HIST_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className="h-18 w-full rounded-md border border-border/80 bg-muted/30 text-primary"
          role="img"
          aria-label="Histogramm"
        >
          {histogram.map((count, index) => {
            const h = (count / peak) * (SPARK_H - 4);
            const w = HIST_W / BUCKETS;
            return (
              <rect
                key={index}
                x={index * w + 0.5}
                y={SPARK_H - h}
                width={w - 1}
                height={h}
                fill="currentColor"
                fillOpacity={0.7}
              >
                <title>{`${count} Werte`}</title>
              </rect>
            );
          })}
        </svg>
        <figcaption className="text-[11px] text-muted-foreground">Verteilung</figcaption>
      </figure>
    </div>
  );
}
