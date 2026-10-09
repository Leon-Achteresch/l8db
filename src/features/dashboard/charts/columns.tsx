import { useMemo, useState } from "react";
import { COMPARE_MARK, fmtValue, fmtValueCompact } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import {
  CHAR_WIDTH,
  type ChartProps,
  dimAttr,
  dimensionLabels,
  series,
  seriesColor,
  xAxisLabels,
} from "./chart-utils";
import { barPath, niceTicks, scale, stackValues } from "./svg-geometry";
import { TargetLine } from "./target-line";

const MAX_BAR = 24;
const GAP = 2;

export function Columns({ rows, shape, options, compare }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const horizontal = options.horizontal;
  const count = shape.metrics.length;
  const chart = useMemo(() => {
    const data = series(rows, shape);
    const names = dimensionLabels(data.map((row) => String(row.name)));
    const stacked = options.stacked && count > 1;
    const stacks = stackValues(
      data,
      shape.metrics.map((m) => m.key),
      stacked,
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
    if (options.target !== null) {
      min = Math.min(min, options.target);
      max = Math.max(max, options.target);
    }
    const ticks = niceTicks(
      min,
      max,
      Math.max(2, Math.min(4, Math.floor((horizontal ? width : height) / 70))),
    );
    const tickText = ticks.map((t) => fmtValueCompact(t, options));
    const categoryText = horizontal
      ? names.short.map((name) => (name.length > 18 ? `${name.slice(0, 17)}…` : name))
      : names.short;
    const left = horizontal
      ? Math.max(32, ...categoryText.map((t) => t.length * CHAR_WIDTH)) + 12
      : Math.max(28, ...tickText.map((t) => t.length * CHAR_WIDTH)) + 12;
    const box = { left, top: 8, right: width - (horizontal ? 16 : 6), bottom: height - 24 };
    const n = data.length;
    const catStart = horizontal ? box.top : box.left;
    const band = ((horizontal ? box.bottom : box.right) - catStart) / Math.max(n, 1);
    const lanes = stacked ? 1 : count;
    const size = Math.max(1, Math.min(MAX_BAR, (band * 0.7 - GAP * (lanes - 1)) / lanes));
    const group = size * lanes + GAP * (lanes - 1);
    const value = horizontal
      ? scale([ticks[0], ticks[ticks.length - 1]], [box.left, box.right])
      : scale([ticks[0], ticks[ticks.length - 1]], [box.bottom, box.top]);
    const zero = value(0);
    const center = (j: number) => catStart + j * band + band / 2;
    const valueLabels = ticks.map((t, i) => ({ pos: value(t), text: tickText[i] }));
    const categoryLabels = horizontal
      ? categoryText.map((text, j) => ({ pos: center(j), text }))
      : xAxisLabels(categoryText, center, band, width);
    const bars = stacks.flatMap((stack, i) =>
      stack.map(([low, high], j) => {
        const c0 = center(j) - group / 2 + (stacked ? 0 : i * (size + GAP));
        const inset = stacked && i > 0 && high !== low ? Math.sign(high - low) * GAP : 0;
        const from = value(low) + (horizontal ? inset : -inset);
        const to = value(high);
        const top =
          !stacked || i === count - 1 || stacks.slice(i + 1).every((s) => s[j][1] === s[j][0]);
        return {
          key: `${shape.metrics[i].key}-${j}`,
          fill: seriesColor(i, shape, options),
          d: barPath(c0, size, from, to, top ? 4 : 0, horizontal),
          tip: to,
          mid: c0 + size / 2,
          value: high - low,
          show: !stacked || top,
          total: high,
        };
      }),
    );
    const paths = new Map<string, string>();
    for (const bar of bars) paths.set(bar.fill, (paths.get(bar.fill) ?? "") + bar.d);
    const ghostTicks = ghost.flatMap((v, j) => {
      if (v === null) return [];
      const at = value(v);
      const from = center(j) - group / 2 - 3;
      const to = from + (stacked ? group : size) + 6;
      return [
        horizontal ? { x1: at, x2: at, y1: from, y2: to } : { x1: from, x2: to, y1: at, y2: at },
      ];
    });
    const marks = (
      <>
        <CartesianAxes
          box={box}
          gridY={options.showGrid && !horizontal ? ticks.filter((t) => t !== 0).map(value) : []}
          gridX={options.showGrid && horizontal ? ticks.filter((t) => t !== 0).map(value) : []}
          baseline={horizontal ? { x: zero } : { y: zero }}
          xLabels={horizontal ? valueLabels : categoryLabels}
          yLabels={horizontal ? categoryLabels : valueLabels}
        />
        {[...paths].map(([fill, d]) => (
          <path key={fill} d={d} fill={fill} />
        ))}
        {options.target !== null && (
          <TargetLine
            box={box}
            pos={value(options.target)}
            horizontal={horizontal}
            label={options.targetLabel || `Ziel ${fmtValueCompact(options.target, options)}`}
          />
        )}
        {ghostTicks.map((tick) => (
          <line
            key={`${tick.x1}-${tick.y1}`}
            {...tick}
            stroke={COMPARE_MARK}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {options.labels &&
          bars
            .filter((bar) => bar.show)
            .map((bar) => (
              <text
                key={bar.key}
                x={horizontal ? bar.tip + 5 : bar.mid}
                y={horizontal ? bar.mid : bar.tip - 5}
                textAnchor={horizontal ? "start" : "middle"}
                dominantBaseline={horizontal ? "middle" : "auto"}
                fontSize={10}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {fmtValueCompact(stacked ? bar.total : bar.value, { ...options, unit: "" })}
              </text>
            ))}
      </>
    );
    return { data, names, box, n, catStart, band, center, marks };
  }, [rows, shape, options, horizontal, count, compare, width, height]);
  const { data, names, box, n, catStart, band, center } = chart;
  const hovered = hover !== null ? data[hover] : undefined;
  const ghostValue = hover !== null ? compare?.values[hover] : null;

  return (
    <div
      ref={ref}
      className="relative h-full w-full"
      data-active-dim={
        hover !== null && shape.dimension ? dimAttr(rows[hover]?.[shape.dimension]) : undefined
      }
    >
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseMove={(event) => {
            if (!n) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const offset = horizontal ? event.clientY - rect.top : event.clientX - rect.left;
            const next = Math.max(0, Math.min(n - 1, Math.floor((offset - catStart) / band)));
            if (next !== hover) setHover(next);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {hover !== null && (
            <rect
              x={horizontal ? box.left : catStart + hover * band}
              y={horizontal ? catStart + hover * band : box.top}
              width={horizontal ? box.right - box.left : band}
              height={horizontal ? band : box.bottom - box.top}
              fill="var(--muted)"
              opacity={0.6}
            />
          )}
          {chart.marks}
        </svg>
      )}
      {hover !== null && hovered && (
        <ChartTooltip
          x={horizontal ? (box.left + box.right) / 2 : center(hover)}
          y={horizontal ? center(hover) : (box.top + box.bottom) / 2}
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
                    color: COMPARE_MARK,
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
