import { useState } from "react";
import { fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { axisTick, type ChartProps, color, series } from "./chart-utils";
import { labelStep, niceTicks, polar } from "./svg-geometry";

export function RadarNet({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = series(rows, shape);
  const n = data.length;
  const cx = width / 2;
  const cy = height / 2;
  const radius = (Math.min(width, height) / 2) * 0.62;
  const ticks = niceTicks(
    0,
    Math.max(0, ...data.flatMap((row) => shape.metrics.map((m) => Number(row[m.key]) || 0))),
  );
  const max = ticks[ticks.length - 1] || 1;
  const angle = (i: number) => (i * Math.PI * 2) / Math.max(n, 1);
  const ring = (r: number) => data.map((_, i) => polar(cx, cy, r, angle(i)).join(",")).join(" ");
  const labelEvery = labelStep((Math.PI * 2 * radius) / Math.max(n, 1), 4);
  const hovered = hover !== null ? data[hover] : undefined;

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && n > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const a = Math.atan2(event.clientX - rect.left - cx, cy - (event.clientY - rect.top));
            const next = Math.round((((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * n) % n;
            if (next !== hover) setHover(next);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.slice(1).map((t) => (
            <polygon key={t} points={ring((t / max) * radius)} fill="none" stroke="var(--border)" />
          ))}
          {data.map((row, i) => {
            if (i % labelEvery !== 0) return null;
            const [x, y] = polar(cx, cy, radius, angle(i));
            const [lx, ly] = polar(cx, cy, radius + 14, angle(i));
            return (
              <g key={String(row.name)}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" />
                <text
                  x={lx}
                  y={ly}
                  textAnchor={Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end"}
                  dominantBaseline="middle"
                  {...axisTick}
                >
                  {String(row.name)}
                </text>
              </g>
            );
          })}
          {shape.metrics.map((m, k) => {
            const stroke = color(k + options.colorOffset);
            const points = data.map((row, i) =>
              polar(cx, cy, ((Number(row[m.key]) || 0) / max) * radius, angle(i)),
            );
            return (
              <g key={m.key}>
                <polygon
                  points={points.map((p) => p.join(",")).join(" ")}
                  fill={stroke}
                  fillOpacity={0.3}
                  stroke={stroke}
                  strokeWidth={2}
                />
                {points.map(([x, y], i) =>
                  n > 60 && hover !== i ? null : (
                    <circle
                      key={String(data[i].name)}
                      cx={x}
                      cy={y}
                      r={hover === i ? 4 : 2}
                      fill={stroke}
                    />
                  ),
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && hovered && (
        <ChartTooltip
          x={polar(cx, cy, radius, angle(hover))[0]}
          y={polar(cx, cy, radius, angle(hover))[1]}
          width={width}
          title={String(hovered.name)}
          entries={shape.metrics.map((m, k) => ({
            label: m.label,
            value: fmtNumber(Number(hovered[m.key]) || 0),
            color: color(k + options.colorOffset),
          }))}
        />
      )}
    </div>
  );
}
