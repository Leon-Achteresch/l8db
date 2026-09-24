import { fmtCompact, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { type ChartProps, color } from "./chart-utils";
import { roundArcPath } from "./svg-geometry";

const START = (-110 * Math.PI) / 180;
const SWEEP = (220 * Math.PI) / 180;
const PAD = (2 * Math.PI) / 180;

export function GaugeChart({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [mv, mm] = shape.metrics;
  const value = rows.reduce((s, r) => s + toNumber(r[mv?.key ?? ""]), 0);
  const max = rows.reduce((s, r) => s + toNumber(r[mm?.key ?? ""]), 0) || 1;
  const pct = Math.max(0, Math.min(1, value / max));
  const outer = Math.min(width / 2, height * 0.6);
  const stroke = outer * 0.32;
  const r = outer - stroke / 2;
  const cx = width / 2;
  const cy = height * 0.6;
  const split = START + SWEEP * pct;
  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg className="chart-surface" width={width} height={height} aria-hidden="true">
          {pct < 1 && (
            <path
              d={roundArcPath(cx, cy, r, stroke, pct > 0 ? split + PAD / 2 : START, START + SWEEP)}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          )}
          {pct > 0 && (
            <path
              d={roundArcPath(cx, cy, r, stroke, START, pct < 1 ? split - PAD / 2 : split)}
              fill="none"
              stroke={color(options.colorOffset)}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-[42%] text-center">
        <div className="text-2xl font-semibold tabular-nums">{Math.round(pct * 100)}%</div>
        <div className="text-[11px] text-muted-foreground">
          {fmtCompact(value)} von {fmtCompact(max)}
        </div>
      </div>
    </div>
  );
}
