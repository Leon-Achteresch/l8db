import { toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { type ChartProps, color } from "./chart-utils";
import { roundArcPath } from "./svg-geometry";

const PAD = (3 * Math.PI) / 180;

export function Score({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [mv, mm] = shape.metrics;
  const items = rows.map((row, i) => ({
    name: shape.dimension ? toLabel(row[shape.dimension]) : `#${i + 1}`,
    value: toNumber(row[mv?.key ?? ""]),
    max: Math.max(toNumber(row[mm?.key ?? ""]), toNumber(row[mv?.key ?? ""]), 0),
    color: color(i + options.colorOffset),
  }));
  const total = items.reduce((s, i) => s + i.value, 0);
  const totalMax = items.reduce((s, i) => s + i.max, 0) || 1;
  const slices = items
    .flatMap((item) => [
      { key: item.name, value: item.value, fill: item.color },
      {
        key: `${item.name} offen`,
        value: Math.max(0, item.max - item.value),
        fill: "var(--muted)",
      },
    ])
    .filter((slice) => slice.value > 0);
  const outer = Math.min(width, height) / 2;
  const stroke = outer * 0.3;
  const r = outer - stroke / 2;
  let start = 0;

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg className="chart-surface" width={width} height={height} aria-hidden="true">
          {slices.map((slice) => {
            const sweep = (slice.value / totalMax) * Math.PI * 2;
            const from = start + PAD / 2;
            start += sweep;
            return (
              <path
                key={slice.key}
                d={roundArcPath(width / 2, height / 2, r, stroke, from, start - PAD / 2)}
                fill="none"
                stroke={slice.fill}
                strokeWidth={stroke}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="text-3xl font-semibold tabular-nums">
          {Math.round((total / totalMax) * 100)}
        </span>
      </div>
    </div>
  );
}
