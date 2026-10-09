import { useState } from "react";
import { fmtShare, fmtValue, fmtValueCompact } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, categories, dimAttr, hoveredIndex } from "./chart-utils";
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
            const inner = { x: x + 1, y: y + 1, w: Math.max(0, w - 2), h: Math.max(0, h - 2) };
            return (
              <g key={item.name} data-index={i} data-dim={dimAttr(item.raw)} tabIndex={0}>
                <rect
                  x={inner.x}
                  y={inner.y}
                  width={inner.w}
                  height={inner.h}
                  rx={4}
                  fill={`color-mix(in oklab, ${item.color} ${hover === i ? 34 : 22}%, var(--card))`}
                />
                <rect
                  x={inner.x}
                  y={inner.y}
                  width={Math.min(3, inner.w)}
                  height={inner.h}
                  rx={1.5}
                  fill={item.color}
                />
                {roomy && (
                  <text
                    x={inner.x + 10}
                    y={inner.y + 18}
                    fontSize={11}
                    fontWeight={500}
                    fill="var(--foreground)"
                  >
                    {item.name}
                  </text>
                )}
                {roomy && options.labels && (
                  <text
                    x={inner.x + 10}
                    y={inner.y + 33}
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    className="tabular-nums"
                  >
                    {fmtValueCompact(item.value, options)} · {fmtShare(item.value, total)}
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
          title={hovered.item.name}
          entries={[
            {
              label: shape.metrics[0]?.label ?? "",
              value: fmtValue(hovered.item.value, options),
              color: hovered.item.color,
            },
            {
              label: "Anteil",
              value: fmtShare(hovered.item.value, total),
              color: "transparent",
              muted: true,
            },
          ]}
        />
      )}
    </div>
  );
}
