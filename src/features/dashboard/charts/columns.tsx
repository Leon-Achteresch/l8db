import { useState } from "react";
import { fmtCompact, fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, color, series } from "./chart-utils";
import { labelStep, niceTicks, scale, stackValues, valueDomain } from "./svg-geometry";

export function Columns({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = series(rows, shape);
  const single = shape.metrics.length === 1;
  const horizontal = options.horizontal;
  const stacks = stackValues(
    data,
    shape.metrics.map((m) => m.key),
    options.stacked,
  );
  const domain = valueDomain(stacks);
  const ticks = niceTicks(domain[0], domain[1]);
  const box = { left: horizontal ? 100 : 40, top: 12, right: width - 8, bottom: height - 20 };
  const n = data.length;
  const catStart = horizontal ? box.top : box.left;
  const band = ((horizontal ? box.bottom : box.right) - catStart) / Math.max(n, 1);
  const inner = band * 0.75;
  const thick = options.stacked ? inner : inner / Math.max(shape.metrics.length, 1);
  const value = horizontal
    ? scale(domain, [box.left, box.right])
    : scale(domain, [box.bottom, box.top]);
  const center = (j: number) => catStart + j * band + band / 2;
  const names = data.map((row) => String(row.name));
  const step = labelStep(band, Math.max(0, ...names.map((name) => name.length)));
  const valueLabels = ticks.map((t) => ({ pos: value(t), text: fmtCompact(t) }));
  const categoryLabels = names.flatMap((name, j) =>
    horizontal
      ? [{ pos: center(j), text: name.length > 14 ? `${name.slice(0, 13)}…` : name }]
      : j % step === 0
        ? [{ pos: center(j), text: name }]
        : [],
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
            />
          )}
          <CartesianAxes
            box={box}
            gridY={options.showGrid && !horizontal ? ticks.map(value) : []}
            gridX={options.showGrid && horizontal ? ticks.map(value) : []}
            xLabels={horizontal ? valueLabels : categoryLabels}
            yLabels={horizontal ? categoryLabels : valueLabels}
          />
          {stacks.map((stack, i) =>
            stack.map(([low, high], j) => {
              const c0 =
                catStart + j * band + (band - inner) / 2 + (options.stacked ? 0 : i * thick);
              const v0 = value(low);
              const v1 = value(high);
              const length = Math.abs(v1 - v0);
              const size = Math.max(thick - 1, 1);
              const radius =
                options.stacked && i < shape.metrics.length - 1
                  ? 0
                  : Math.min(6, size / 2, length / 2);
              const fill = color((single ? j : i) + options.colorOffset);
              return (
                <g key={`${shape.metrics[i].key}-${String(data[j].name)}`}>
                  <rect
                    x={horizontal ? Math.min(v0, v1) : c0}
                    y={horizontal ? c0 : Math.min(v0, v1)}
                    width={horizontal ? length : size}
                    height={horizontal ? size : length}
                    rx={radius}
                    fill={fill}
                  />
                  {options.labels && (
                    <text
                      x={horizontal ? Math.max(v0, v1) + 4 : c0 + size / 2}
                      y={horizontal ? c0 + size / 2 : Math.min(v0, v1) - 4}
                      textAnchor={horizontal ? "start" : "middle"}
                      dominantBaseline={horizontal ? "middle" : "auto"}
                      fontSize={10}
                      fill="var(--muted-foreground)"
                    >
                      {fmtCompact(high - low)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
      )}
      {hover !== null && hovered && (
        <ChartTooltip
          x={horizontal ? (box.left + box.right) / 2 : center(hover)}
          y={horizontal ? center(hover) : (box.top + box.bottom) / 2}
          width={width}
          title={String(hovered.name)}
          entries={shape.metrics.map((m, i) => ({
            label: m.label,
            value: fmtNumber(Number(hovered[m.key]) || 0),
            color: color((single ? hover : i) + options.colorOffset),
          }))}
        />
      )}
    </div>
  );
}
