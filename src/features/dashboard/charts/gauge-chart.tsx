import { fmtNumber, fmtValueCompact, periodProgress, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { accent, type ChartProps } from "./chart-utils";
import { arcPath, polar } from "./svg-geometry";

const STROKE = 12;
const FROM = -Math.PI / 2;

export function GaugeChart({ rows, shape, options, period }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [mv, mm] = shape.metrics;
  const value = rows.reduce((s, r) => s + toNumber(r[mv?.key ?? ""]), 0);
  const max = rows.reduce((s, r) => s + toNumber(r[mm?.key ?? ""]), 0);
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.max(0, Math.min(1, ratio));
  const pace = period ? periodProgress(period) : null;
  const cx = width / 2;
  const cy = height - 4;
  const r = Math.max(0, Math.min(width / 2 - STROKE - 2, height - STROKE - 8));
  const angle = (fraction: number) => FROM + Math.PI * fraction;
  const paceInner = pace !== null ? polar(cx, cy, r - STROKE, angle(pace)) : null;
  const paceOuter = pace !== null ? polar(cx, cy, r + STROKE, angle(pace)) : null;
  const paceLabel = pace !== null ? polar(cx, cy, r - STROKE - 6, angle(pace)) : null;
  return (
    <div ref={ref} className="relative h-full w-full">
      {r > STROKE * 2 && (
        <svg className="chart-surface" width={width} height={height} aria-hidden="true">
          <path
            d={arcPath(cx, cy, r, FROM, angle(1))}
            fill="none"
            stroke="var(--dash-track)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          {pct > 0 && (
            <path
              d={arcPath(cx, cy, r, FROM, angle(Math.max(pct, 0.005)))}
              fill="none"
              stroke={accent(options)}
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
          )}
          {paceInner && paceOuter && paceLabel && pace !== null && (
            <g>
              <line
                x1={paceInner[0]}
                y1={paceInner[1]}
                x2={paceOuter[0]}
                y2={paceOuter[1]}
                stroke="var(--foreground)"
                strokeWidth={2}
                strokeLinecap="round"
              />
              <text
                x={paceLabel[0]}
                y={paceLabel[1]}
                textAnchor={pace > 0.5 ? "end" : "start"}
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                Soll {fmtNumber(pace * 100, 0)} %
              </text>
            </g>
          )}
          <text
            x={cx}
            y={cy - 24}
            textAnchor="middle"
            fontSize={Math.min(28, Math.max(18, r / 3.2))}
            fontWeight={600}
            fill="var(--foreground)"
            className="tabular-nums"
          >
            {max > 0 ? `${fmtNumber(ratio * 100, 0)} %` : "–"}
          </text>
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fontSize={11}
            fill="var(--muted-foreground)"
            className="tabular-nums"
          >
            {fmtValueCompact(value, options)} von {fmtValueCompact(max, options)}
          </text>
        </svg>
      )}
    </div>
  );
}
