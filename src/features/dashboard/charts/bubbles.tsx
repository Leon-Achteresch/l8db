import { useMemo, useState } from "react";
import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { CartesianAxes } from "./cartesian-axes";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, color } from "./chart-utils";
import { circlePath, niceTicks, scale } from "./svg-geometry";

export function Bubbles({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mx, my, mz] = shape.metrics;
  const chart = useMemo(() => {
    const points = rows.map((r) => ({
      group: shape.dimension ? toLabel(r[shape.dimension]) : "Alle",
      x: toNumber(r[mx?.key ?? ""]),
      y: toNumber(r[my?.key ?? ""]),
      z: mz ? toNumber(r[mz.key]) : 1,
    }));
    const groups = new Map<string, number>();
    for (const p of points) if (!groups.has(p.group)) groups.set(p.group, groups.size);
    const fillOf = (group: string) => color((groups.get(group) ?? 0) + options.colorOffset);
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
    const paths = new Map<string, string>();
    for (const p of points) {
      const fill = fillOf(p.group);
      paths.set(fill, (paths.get(fill) ?? "") + circlePath(x(p.x), y(p.y), radius(p.z)));
    }
    const pointAt = (px: number, py: number) => {
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        const r = radius(p.z);
        if ((x(p.x) - px) ** 2 + (y(p.y) - py) ** 2 <= r * r) return i;
      }
      return null;
    };
    const marks = (
      <>
        <CartesianAxes
          box={box}
          gridX={options.showGrid ? xTicks.map(x) : []}
          gridY={options.showGrid ? yTicks.map(y) : []}
          xLabels={xTicks.map((t) => ({ pos: x(t), text: fmtCompact(t) }))}
          yLabels={yTicks.map((t) => ({ pos: y(t), text: fmtCompact(t) }))}
        />
        {[...paths].map(([fill, d]) => (
          <path key={fill} d={d} fill={fill} fillOpacity={0.85} stroke={fill} />
        ))}
      </>
    );
    return { points, fillOf, x, y, pointAt, marks };
  }, [rows, shape, options, mx, my, mz, width, height]);
  const { points, fillOf, x, y, pointAt } = chart;
  const hovered = hover !== null ? points[hover] : undefined;
  const hoverColor = hovered ? fillOf(hovered.group) : "";

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHover(pointAt(event.clientX - rect.left, event.clientY - rect.top));
          }}
        >
          {chart.marks}
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
