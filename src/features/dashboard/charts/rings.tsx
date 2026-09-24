import { useState } from "react";
import { fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, categories, hoveredIndex } from "./chart-utils";
import { roundArcPath } from "./svg-geometry";

export function Rings({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const items = categories(rows, shape, options.colorOffset).sort((a, b) => a.value - b.value);
  const max = Math.max(1, ...items.map((i) => i.value));
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) / 2;
  const inner = outer * 0.35;
  const band = (outer - inner) / Math.max(items.length, 1);
  const stroke = band * 0.82;
  const hovered = hover !== null ? items[hover] : undefined;

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
          {items.map((item, i) => {
            const r = inner + band * i + band / 2;
            return (
              <g key={item.name} data-index={i}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth={stroke}
                />
                <path
                  d={roundArcPath(cx, cy, r, stroke, 0, (item.value / max) * Math.PI * 2)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && (
        <ChartTooltip
          x={cx}
          y={cy}
          width={width}
          entries={[{ label: hovered.name, value: fmtNumber(hovered.value), color: hovered.color }]}
        />
      )}
    </div>
  );
}
