import { useId, useMemo, useState } from "react";
import { COMPARE_COLOR, fmtValue, fmtValueCompact } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import {
  CHAR_WIDTH,
  type ChartProps,
  dimensionLabels,
  series,
  seriesColor,
  xAxisLabels,
} from "./chart-utils";
import { curvePath, niceTicks, type Point, scale, stackValues } from "./svg-geometry";

const MAX_DOTS = 40;

export function PointSeriesChart({
  rows,
  shape,
  options,
  compare,
  area,
}: ChartProps & { area: boolean }) {
  const uid = useId();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const count = shape.metrics.length;
  const chart = useMemo(() => {
    const data = series(rows, shape);
    const names = dimensionLabels(data.map((row) => String(row.name)));
    const stacks = stackValues(
      data,
      shape.metrics.map((m) => m.key),
      area && options.stacked,
    );
    const ghost = compare?.values ?? [];
    let min = 0;
    let max = 0;
    for (const stack of stacks)
      for (const [low, high] of stack) {
        min = Math.min(min, low, high);
        max = Math.max(max, low, high);
      }
    for (const value of ghost)
      if (value !== null) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    const ticks = niceTicks(min, max, Math.max(2, Math.min(4, Math.floor(height / 70))));
    const tickText = ticks.map((t) => fmtValueCompact(t, options));
    const left = Math.max(28, ...tickText.map((t) => t.length * CHAR_WIDTH)) + 12;
    const box = { left, top: 8, right: width - 10, bottom: height - 24 };
    const y = scale([ticks[0], ticks[ticks.length - 1]], [box.bottom, box.top]);
    const n = data.length;
    const span = box.right - box.left;
    const x = (i: number) => (n < 2 ? box.left + span / 2 : box.left + (i * span) / (n - 1));
    const tops = stacks.map((stack) => stack.map(([, high], j): Point => [x(j), y(high)]));
    const ghostPoints = ghost.flatMap((value, j): Point[] =>
      value === null ? [] : [[x(j), y(value)]],
    );
    const axes = (
      <>
        <defs>
          {shape.metrics.map((m, i) => (
            <linearGradient key={m.key} id={`fill-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(i, shape, options)} stopOpacity={0.24} />
              <stop
                offset="100%"
                stopColor={seriesColor(i, shape, options)}
                stopOpacity={options.stacked && count > 1 ? 0.14 : 0.02}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianAxes
          box={box}
          gridY={options.showGrid ? ticks.filter((t) => t !== 0).map(y) : []}
          baseline={{ y: y(Math.max(ticks[0], Math.min(0, ticks[ticks.length - 1]))) }}
          yLabels={ticks.map((t, i) => ({ pos: y(t), text: tickText[i] }))}
          xLabels={xAxisLabels(names.short, x, n < 2 ? span : span / (n - 1), width)}
        />
      </>
    );
    const marks = (
      <>
        {ghostPoints.length > 1 && (
          <path
            d={curvePath(ghostPoints, options.curve)}
            fill="none"
            stroke={COMPARE_COLOR}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {stacks.map((stack, i) => {
          const stroke = seriesColor(i, shape, options);
          const top = tops[i];
          const line = curvePath(top, options.curve);
          const last = top[top.length - 1];
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
              <path
                d={line}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {!area &&
                options.labels &&
                n <= MAX_DOTS &&
                top.map(([px, py], j) => (
                  <text
                    key={`l${String(data[j].name)}`}
                    x={px}
                    y={py - 9}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                    className="tabular-nums"
                  >
                    {fmtValueCompact(stack[j][1] - stack[j][0], { ...options, unit: "" })}
                  </text>
                ))}
              {last && (
                <circle
                  cx={last[0]}
                  cy={last[1]}
                  r={3.5}
                  fill={stroke}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
      </>
    );
    return { data, names, box, n, span, x, y, tops, axes, marks };
  }, [rows, shape, options, area, width, height, uid, compare, count]);
  const { data, names, box, n, span, x, y, tops } = chart;
  const hovered = hover !== null ? data[hover] : undefined;
  const ghostValue = hover !== null ? compare?.values[hover] : null;

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
          {chart.axes}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={box.top}
              y2={box.bottom}
              stroke="var(--dash-axis)"
            />
          )}
          {chart.marks}
          {hover !== null && ghostValue !== null && ghostValue !== undefined && (
            <circle
              cx={x(hover)}
              cy={y(ghostValue)}
              r={3.5}
              fill={COMPARE_COLOR}
              stroke="var(--card)"
              strokeWidth={2}
            />
          )}
          {hover !== null &&
            tops.map((top, i) =>
              top[hover] ? (
                <circle
                  key={shape.metrics[i].key}
                  cx={top[hover][0]}
                  cy={top[hover][1]}
                  r={4.5}
                  fill={seriesColor(i, shape, options)}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ) : null,
            )}
        </svg>
      )}
      {hover !== null && hovered && (
        <ChartTooltip
          x={x(hover)}
          y={(box.top + box.bottom) / 2}
          width={width}
          title={names.long[hover]}
          entries={[
            ...shape.metrics.map((m, i) => ({
              label: m.label,
              value: fmtValue(Number(hovered[m.key]) || 0, options),
              color: seriesColor(i, shape, options),
            })),
            ...(compare && ghostValue !== null && ghostValue !== undefined
              ? [
                  {
                    label: compare.short,
                    value: fmtValue(ghostValue, options),
                    color: COMPARE_COLOR,
                    line: true,
                    muted: true,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
