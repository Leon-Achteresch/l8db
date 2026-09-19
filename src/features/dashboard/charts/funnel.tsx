import { fmtCompact } from "@/lib/dashboards";
import { type ChartProps, categories } from "./chart-utils";

export function Funnel({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset);
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((i) => i.value));
  const n = items.length;
  const segW = 100 / n;
  const bridge = Math.min(12, segW * 0.28);
  const heights = items.map((i) => Math.max(8, (i.value / max) * 100));
  const paths = items.map((_, i) => {
    const h = heights[i];
    const x0 = i * segW;
    const x1 = x0 + segW;
    const top = 50 - h / 2;
    const bottom = 50 + h / 2;
    const prev = i > 0 ? heights[i - 1] : h;
    const ptop = 50 - prev / 2;
    const pbottom = 50 + prev / 2;
    const c = x0 + bridge / 2;
    return `M ${x0} ${ptop} C ${c} ${ptop} ${c} ${top} ${x0 + bridge} ${top} L ${x1} ${top} L ${x1} ${bottom} L ${x0 + bridge} ${bottom} C ${c} ${bottom} ${c} ${pbottom} ${x0} ${pbottom} Z`;
  });
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Funnel"
      >
        {paths.map((d, i) => (
          <g key={items[i].name}>
            <path d={d} fill={items[i].color} opacity={0.18} transform="translate(0 0)" />
            <path d={d} fill={items[i].color} transform="scale(1 0.8) translate(0 12.5)" />
          </g>
        ))}
      </svg>
      {items.map((item, i) => (
        <span
          key={item.name}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-border/60"
          style={{ left: `${i * segW + segW / 2}%`, top: "50%" }}
        >
          {options.showPercent
            ? `${Math.round((item.value / max) * 100)}%`
            : fmtCompact(item.value)}
        </span>
      ))}
    </div>
  );
}
