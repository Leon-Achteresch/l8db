import { useState } from "react";
import { fmtCompact, fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, categories, hoveredIndex } from "./chart-utils";
import { squarify } from "./svg-geometry";

export function TreemapChart({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const items = categories(rows, shape, options.colorOffset).filter((i) => i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const tiles = squarify(items, 0, 0, width, height);
  const hovered = hover !== null ? tiles[hover] : undefined;

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
          {tiles.map(({ item, x, y, width: w, height: h }, i) => {
            const roomy = w > 56 && h > 34;
            return (
              <g key={item.name} data-index={i}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={8}
                  fill={item.color}
                  stroke="var(--card)"
                  strokeWidth={3}
                />
                {roomy && (
                  <text
                    x={x + 10}
                    y={y + 18}
                    fontSize={11}
                    fontWeight={600}
                    fill="rgb(0 0 0 / 0.75)"
                  >
                    {item.name}
                  </text>
                )}
                {roomy && options.labels && (
                  <text x={x + 10} y={y + 34} fontSize={11} fill="rgb(0 0 0 / 0.6)">
                    {fmtCompact(item.value)} · {Math.round((item.value / total) * 100)}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hovered && (
        <ChartTooltip
          x={hovered.x + hovered.width / 2}
          y={hovered.y + hovered.height / 2}
          width={width}
          entries={[
            {
              label: hovered.item.name,
              value: fmtNumber(hovered.item.value),
              color: hovered.item.color,
            },
          ]}
        />
      )}
    </div>
  );
}
