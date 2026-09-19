import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { fmtCompact, toNumber } from "@/lib/dashboards";
import { type ChartProps, color } from "./chart-utils";

export function GaugeChart({ rows, shape, options }: ChartProps) {
  const [mv, mm] = shape.metrics;
  const value = rows.reduce((s, r) => s + toNumber(r[mv?.key ?? ""]), 0);
  const max = rows.reduce((s, r) => s + toNumber(r[mm?.key ?? ""]), 0) || 1;
  const pct = Math.max(0, Math.min(1, value / max));
  const data = [
    { name: "Wert", value: pct, fill: color(options.colorOffset) },
    { name: "Rest", value: 1 - pct, fill: "var(--muted)" },
  ];
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={data}
            dataKey="value"
            startAngle={200}
            endAngle={-20}
            innerRadius="68%"
            outerRadius="100%"
            cornerRadius={99}
            paddingAngle={2}
            stroke="none"
            cy="60%"
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[42%] text-center">
        <div className="text-2xl font-semibold tabular-nums">{Math.round(pct * 100)}%</div>
        <div className="text-[11px] text-muted-foreground">
          {fmtCompact(value)} von {fmtCompact(max)}
        </div>
      </div>
    </div>
  );
}
