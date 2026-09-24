import { useState } from "react";
import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, color, hoveredIndex } from "./chart-utils";
import { niceTicks, scale } from "./svg-geometry";

export function Bubbles({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mx, my, mz] = shape.metrics;
  const points = rows.map((r) => ({
    group: shape.dimension ? toLabel(r[shape.dimension]) : "Alle",
    x: toNumber(r[mx?.key ?? ""]),
    y: toNumber(r[my?.key ?? ""]),
    z: mz ? toNumber(r[mz.key]) : 1,
  }));
  const groups = [...new Set(points.map((p) => p.group))];
  const xTicks = niceTicks(
    Math.min(0, ...points.map((p) => p.x)),
    Math.max(0, ...points.map((p) => p.x)),
  );
  const yTicks = niceTicks(
    Math.min(0, ...points.map((p) => p.y)),
    Math.max(0, ...points.map((p) => p.y)),
  );
  const box = { left: 40, top: 8, right: width - 8, bottom: height - 20 };
  const x = scale([xTicks[0], xTicks[xTicks.length - 1]], [box.left, box.right]);
  const y = scale([yTicks[0], yTicks[yTicks.length - 1]], [box.bottom, box.top]);
  const zs = points.map((p) => p.z);
  const area = scale([Math.min(...zs), Math.max(...zs)], [60, 600]);
  const radius = (z: number) => (mz ? Math.sqrt(area(z) / Math.PI) : 4);
  const hovered = hover !== null ? points[hover] : undefined;
  const hoverColor = hovered ? color(groups.indexOf(hovered.group) + options.colorOffset) : "";

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => setHover(hoveredIndex(event.target))}
        >
          <CartesianAxes
            box={box}
            gridX={options.showGrid ? xTicks.map(x) : []}
            gridY={options.showGrid ? yTicks.map(y) : []}
            xLabels={xTicks.map((t) => ({ pos: x(t), text: fmtCompact(t) }))}
            yLabels={yTicks.map((t) => ({ pos: y(t), text: fmtCompact(t) }))}
          />
          {points.map((p, i) => {
            const fill = color(groups.indexOf(p.group) + options.colorOffset);
            return (
              <circle
                key={`${p.group}-${p.x}-${p.y}-${p.z}`}
                data-index={i}
                cx={x(p.x)}
                cy={y(p.y)}
                r={radius(p.z)}
                fill={fill}
                fillOpacity={0.85}
                stroke={fill}
              />
            );
          })}
        </svg>
      )}
      {hovered && (
        <ChartTooltip
          x={x(hovered.x)}
          y={y(hovered.y)}
          width={width}
          title={hovered.group}
          entries={(
            [
              [mx, hovered.x],
              [my, hovered.y],
              [mz, hovered.z],
            ] as const
          ).flatMap(([metric, v]) =>
            metric ? [{ label: metric.label, value: fmtNumber(v), color: hoverColor }] : [],
          )}
        />
      )}
    </div>
  );
}
