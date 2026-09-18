import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtCompact, fmtNumber, toNumber } from "@/lib/dashboards";
import { type ChartProps, categories, tooltipStyle } from "./chart-utils";

export function Donut({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset).map((c) => ({ ...c, fill: c.color }));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={items}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="95%"
            paddingAngle={3}
            cornerRadius={8}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) =>
              options.showPercent
                ? `${fmtNumber(toNumber(v))} · ${Math.round((toNumber(v) / total) * 100)}%`
                : fmtNumber(toNumber(v))
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtCompact(total)}</div>
          <div className="text-[11px] text-muted-foreground">Gesamt</div>
        </div>
      </div>
    </div>
  );
}
