import { useState } from "react";
import { fmtCompact, fmtNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, categories, hoveredIndex } from "./chart-utils";
import { polar, sectorPath } from "./svg-geometry";

const PAD = (3 * Math.PI) / 180;

export function Donut({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const items = categories(rows, shape, options.colorOffset).filter((item) => item.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const cx = width / 2;
  const cy = height / 2;
  const outer = (Math.min(width, height) / 2) * 0.95 - 3;
  const inner = (Math.min(width, height) / 2) * 0.62 + 3;
  const pad = items.length > 1 && items.length * PAD < Math.PI ? PAD : 0;
  const available = Math.PI * 2 - items.length * pad;
  let start = 0;
  const slices = items.map((item) => {
    const sweep = (item.value / total) * available;
    const slice = { item, from: start, to: start + sweep };
    start += sweep + pad;
    return slice;
  });
  const hovered = hover !== null ? slices[hover] : undefined;
  const tipAt = hovered ? polar(cx, cy, outer, (hovered.from + hovered.to) / 2) : [0, 0];

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
          {slices.map((slice, i) => (
            <path
              key={slice.item.name}
              data-index={i}
              d={sectorPath(cx, cy, inner, outer, slice.from, slice.to)}
              fill={slice.item.color}
              stroke={slice.item.color}
              strokeWidth={6}
              strokeLinejoin="round"
            />
          ))}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtCompact(total)}</div>
          <div className="text-[11px] text-muted-foreground">Gesamt</div>
        </div>
      </div>
      {hovered && (
        <ChartTooltip
          x={tipAt[0]}
          y={tipAt[1]}
          width={width}
          entries={[
            {
              label: hovered.item.name,
              value: options.showPercent
                ? `${fmtNumber(hovered.item.value)} · ${Math.round((hovered.item.value / total) * 100)}%`
                : fmtNumber(hovered.item.value),
              color: hovered.item.color,
            },
          ]}
        />
      )}
    </div>
  );
}
