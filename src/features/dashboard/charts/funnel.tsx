import { fmtShare, fmtValueCompact } from "@/lib/dashboards";
import { accent, type ChartProps, categories, change, goodness } from "./chart-utils";
import { DeltaBadge } from "./delta-badge";

export function Funnel({ rows, shape, options, compare }: ChartProps) {
  const items = categories(rows, shape);
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((i) => i.value));
  const fill = accent(options);
  return (
    <div className="h-full overflow-y-auto">
      <div
        className="grid min-h-full content-center items-center gap-x-3 gap-y-1 text-xs"
        style={{
          gridTemplateColumns: `minmax(48px,max-content) 1fr auto${options.showPercent ? " auto" : ""}${compare ? " auto" : ""}`,
        }}
      >
        {items.map((item, i) => {
          const delta = compare ? change(item.value, compare.values[i]) : null;
          return (
            <div key={item.name} className="col-span-full grid grid-cols-subgrid items-center">
              <span className="max-w-44 truncate text-right text-muted-foreground">
                {item.name}
              </span>
              <div className="flex h-7 items-center">
                <div
                  className="h-full rounded-[4px] transition-[width] duration-500"
                  style={{
                    width: `${Math.max(0.5, (Math.max(0, item.value) / max) * 100)}%`,
                    background: fill,
                  }}
                />
              </div>
              <span className="text-right font-medium tabular-nums">
                {fmtValueCompact(item.value, options)}
              </span>
              {options.showPercent && (
                <span
                  className="w-12 text-right tabular-nums text-muted-foreground"
                  title="Anteil an der Vorstufe"
                >
                  {i === 0 ? "" : fmtShare(item.value, items[i - 1].value)}
                </span>
              )}
              {compare && (
                <span className="w-14 text-right">
                  {delta !== null && (
                    <DeltaBadge delta={delta} good={goodness(delta, options.invertDelta)} />
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
