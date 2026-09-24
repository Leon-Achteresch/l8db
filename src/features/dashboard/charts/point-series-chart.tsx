import { useId, useState } from "react";
import { fmtCompact, fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, color, series } from "./chart-utils";
import {
  curvePath,
  labelStep,
  niceTicks,
  type Point,
  scale,
  stackValues,
  valueDomain,
} from "./svg-geometry";

const MAX_DOTS = 60;

export function PointSeriesChart({ rows, shape, options, area }: ChartProps & { area: boolean }) {
  const uid = useId();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = series(rows, shape);
  const stacks = stackValues(
    data,
    shape.metrics.map((m) => m.key),
    area && options.stacked,
  );
  const domain = valueDomain(stacks);
  const box = { left: 40, top: 12, right: width - 8, bottom: height - 20 };
  const y = scale(domain, [box.bottom, box.top]);
  const n = data.length;
  const span = box.right - box.left;
  const x = (i: number) => (n < 2 ? box.left + span / 2 : box.left + (i * span) / (n - 1));
  const ticks = niceTicks(domain[0], domain[1]);
  const step = labelStep(
    n < 2 ? span : span / (n - 1),
    Math.max(0, ...data.map((r) => String(r.name).length)),
  );
  const hovered = hover !== null ? data[hover] : undefined;

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseMove={(event) => {
            if (!n) return;
            const offset = event.clientX - event.currentTarget.getBoundingClientRect().left;
            const index = n < 2 ? 0 : Math.round(((offset - box.left) / span) * (n - 1));
            const next = Math.max(0, Math.min(n - 1, index));
            if (next !== hover) setHover(next);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {area && (
            <defs>
              {shape.metrics.map((m, i) => (
                <linearGradient key={m.key} id={`fill-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color(i + options.colorOffset)} stopOpacity={0.35} />
                  <stop
                    offset="100%"
                    stopColor={color(i + options.colorOffset)}
                    stopOpacity={0.08}
                  />
                </linearGradient>
              ))}
            </defs>
          )}
          <CartesianAxes
            box={box}
            gridY={options.showGrid ? ticks.map(y) : []}
            yLabels={ticks.map((t) => ({ pos: y(t), text: fmtCompact(t) }))}
            xLabels={data.flatMap((row, i) =>
              i % step === 0 ? [{ pos: x(i), text: String(row.name) }] : [],
            )}
          />
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={box.top} y2={box.bottom} stroke="var(--border)" />
          )}
          {stacks.map((stack, i) => {
            const stroke = color(i + options.colorOffset);
            const top = stack.map(([, high], j): Point => [x(j), y(high)]);
            const line = curvePath(top, options.curve);
            return (
              <g key={shape.metrics[i].key}>
                {area && (
                  <path
                    d={`${line}${curvePath(
                      stack.map(([low], j): Point => [x(j), y(low)]).reverse(),
                      options.curve,
                      false,
                    )}Z`}
                    fill={`url(#fill-${uid}-${i})`}
                  />
                )}
                <path d={line} fill="none" stroke={stroke} strokeWidth={area ? 2 : 2.5} />
                {!area &&
                  n <= MAX_DOTS &&
                  top.map(([px, py], j) => (
                    <circle key={String(data[j].name)} cx={px} cy={py} r={3} fill={stroke} />
                  ))}
                {!area &&
                  n <= MAX_DOTS &&
                  options.labels &&
                  top.map(([px, py], j) => (
                    <text
                      key={`l${String(data[j].name)}`}
                      x={px}
                      y={py - 8}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--muted-foreground)"
                    >
                      {fmtCompact(stack[j][1] - stack[j][0])}
                    </text>
                  ))}
                {hover !== null && top[hover] && (
                  <circle
                    cx={top[hover][0]}
                    cy={top[hover][1]}
                    r={4}
                    fill={stroke}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && hovered && (
        <ChartTooltip
          x={x(hover)}
          y={(box.top + box.bottom) / 2}
          width={width}
          title={String(hovered.name)}
          entries={shape.metrics.map((m, i) => ({
            label: m.label,
            value: fmtNumber(Number(hovered[m.key]) || 0),
            color: color(i + options.colorOffset),
          }))}
        />
      )}
    </div>
  );
}
