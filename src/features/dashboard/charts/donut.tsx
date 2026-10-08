import { useState } from "react";
import { COMPARE_COLOR, fmtNumber, fmtShare, fmtValue, fmtValueCompact } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, categories, change, color, goodness, hoveredIndex } from "./chart-utils";
import { DeltaBadge } from "./delta-badge";
import { polar, sectorPath } from "./svg-geometry";

const MAX_SLICES = 8;

export function Donut({ rows, shape, options, compare }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const ring = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = categories(rows, shape)
    .map((item, i) => ({ ...item, before: compare?.values[i] ?? null }))
    .filter((item) => item.value > 0);
  const head = all.length > MAX_SLICES ? all.slice(0, MAX_SLICES - 1) : all;
  const rest = all.slice(head.length);
  const items = [
    ...head.map((item, i) => ({ ...item, color: color(i + options.colorOffset) })),
    ...(rest.length
      ? [
          {
            name: `Sonstige (${rest.length})`,
            value: rest.reduce((s, i) => s + i.value, 0),
            before: compare ? rest.reduce((s, i) => s + (i.before ?? 0), 0) : null,
            color: COMPARE_COLOR,
          },
        ]
      : []),
  ];
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const side = width > height * 1.4;
  const size = Math.min(ring.width, ring.height);
  const cx = ring.width / 2;
  const cy = ring.height / 2;
  const outer = size / 2 - 2;
  const inner = outer * 0.74;
  let start = 0;
  const slices = items.map((item) => {
    const sweep = (item.value / total) * Math.PI * 2;
    const slice = { item, from: start, to: start + sweep };
    start += sweep;
    return slice;
  });
  const hovered = hover !== null ? slices[hover] : undefined;
  const tipAt = hovered ? polar(cx, cy, outer, (hovered.from + hovered.to) / 2) : [0, 0];
  const center = hovered?.item ?? null;

  return (
    <div
      ref={ref}
      className={cn("flex h-full w-full gap-4", side ? "flex-row items-center" : "flex-col")}
    >
      <div ref={ring.ref} className="relative min-h-24 min-w-0 flex-1 self-stretch">
        {size > 0 && (
          <svg
            className="chart-surface"
            width={ring.width}
            height={ring.height}
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
                stroke="var(--card)"
                strokeWidth={items.length > 1 ? 2 : 0}
                strokeLinejoin="round"
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            ))}
          </svg>
        )}
        {inner > 28 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div className="max-w-[60%]">
              <div className="truncate text-lg font-semibold tabular-nums tracking-tight">
                {center ? fmtShare(center.value, total) : fmtValueCompact(total, options)}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {center ? center.name : (shape.metrics[0]?.label ?? "Gesamt")}
              </div>
            </div>
          </div>
        )}
        {hovered && (
          <ChartTooltip
            x={tipAt[0]}
            y={tipAt[1]}
            width={ring.width}
            title={hovered.item.name}
            entries={[
              {
                label: shape.metrics[0]?.label ?? "",
                value: fmtValue(hovered.item.value, options),
                color: hovered.item.color,
              },
              ...(compare && hovered.item.before !== null
                ? [
                    {
                      label: compare.short,
                      value: fmtValue(hovered.item.before, options),
                      color: COMPARE_COLOR,
                      muted: true,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
      <ul
        className={cn(
          "min-h-0 space-y-1 overflow-y-auto text-xs",
          side ? "w-[min(260px,55%)] shrink-0" : "max-h-[50%]",
        )}
      >
        {items.map((item, i) => {
          const delta = compare ? change(item.value, item.before) : null;
          return (
            <li
              key={item.name}
              className="flex items-center gap-2 rounded px-1 py-0.5 data-[active=true]:bg-muted/60"
              data-active={hover === i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="tabular-nums">{fmtNumber(item.value, options.decimals)}</span>
              {options.showPercent && (
                <span className="w-10 text-right tabular-nums text-muted-foreground">
                  {fmtShare(item.value, total)}
                </span>
              )}
              {compare && (
                <span className="w-14 text-right">
                  {delta !== null && (
                    <DeltaBadge delta={delta} good={goodness(delta, options.invertDelta)} />
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
