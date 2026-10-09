import { COMPARE_MARK, fmtShare, fmtValue, fmtValueCompact } from "@/lib/dashboards";
import { accent, CHAR_WIDTH, type ChartProps, categories, dimAttr } from "./chart-utils";

export function Bars({ rows, shape, options, compare }: ChartProps) {
  const items = categories(rows, shape);
  const ghost = compare?.values ?? [];
  const max = Math.max(
    1,
    ...items.map((i) => i.value),
    ...ghost.map((v) => v ?? 0),
    options.target ?? 0,
  );
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const fill = accent(options);
  const texts = items.map((item) => ({
    value: fmtValueCompact(item.value, options),
    share: options.showPercent ? fmtShare(item.value, total) : "",
  }));
  const reserve =
    Math.max(...texts.map((t) => (t.value.length + t.share.length) * CHAR_WIDTH)) + 20;
  const scaled = (value: number) => `calc((100% - ${reserve}px) * ${Math.max(0, value) / max})`;
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full auto-rows-[minmax(28px,40px)] grid-cols-[minmax(48px,max-content)_1fr] content-center gap-x-3 text-xs">
        {items.map((item, i) => {
          const before = ghost[i];
          return (
            <button
              type="button"
              key={item.name}
              data-dim={dimAttr(item.raw)}
              className="col-span-2 grid grid-cols-subgrid items-center text-left"
              title={
                compare && before != null
                  ? `${item.name}: ${fmtValue(item.value, options)} · ${compare.short}: ${fmtValue(before, options)}`
                  : `${item.name}: ${fmtValue(item.value, options)}`
              }
            >
              <span className="max-w-44 truncate text-right text-muted-foreground">
                {item.name}
              </span>
              <div className="relative flex h-full items-center">
                <div
                  className="h-3.5 min-w-0.5 rounded-r-[4px] transition-[width] duration-500"
                  style={{ width: scaled(item.value), background: fill }}
                />
                <span className="ml-2 whitespace-nowrap tabular-nums">
                  <span className="font-medium">{texts[i].value}</span>
                  {texts[i].share && (
                    <span className="ml-1.5 text-muted-foreground">{texts[i].share}</span>
                  )}
                </span>
                {options.target !== null && (
                  <span
                    title={options.targetLabel || "Ziel"}
                    className="pointer-events-none absolute inset-y-0.5 w-0 border-l border-dashed border-foreground/60"
                    style={{ left: scaled(options.target) }}
                  />
                )}
                {before != null && (
                  <span
                    className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: scaled(before), background: COMPARE_MARK }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
