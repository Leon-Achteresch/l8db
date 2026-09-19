import { fmtNumber } from "@/lib/dashboards";
import { type ChartProps, categories } from "./chart-utils";

export function Bars({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col justify-center gap-2.5">
        {items.map((item) => {
          const pct = (item.value / max) * 100;
          return (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(56px,auto)_1fr_auto] items-center gap-3 text-xs"
            >
              <span className="truncate text-right text-muted-foreground">{item.name}</span>
              <div className="relative h-4 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(pct, 4)}%`, background: item.color }}
                />
                <span
                  className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `calc(${Math.max(pct, 4)}% - 16px)`, background: item.color }}
                />
              </div>
              <span className="tabular-nums">
                <span className="font-semibold">{fmtNumber(item.value)}</span>
                <span className="ml-1.5 text-muted-foreground">{Math.round(pct)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
