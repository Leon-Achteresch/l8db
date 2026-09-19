import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { toLabel, toNumber } from "@/lib/dashboards";
import { type ChartProps, color } from "./chart-utils";

export function Score({ rows, shape, options }: ChartProps) {
  const [mv, mm] = shape.metrics;
  const items = rows.map((row, i) => ({
    name: shape.dimension ? toLabel(row[shape.dimension]) : `#${i + 1}`,
    value: toNumber(row[mv?.key ?? ""]),
    max: Math.max(toNumber(row[mm?.key ?? ""]), toNumber(row[mv?.key ?? ""]), 0),
    color: color(i + options.colorOffset),
  }));
  const total = items.reduce((s, i) => s + i.value, 0);
  const totalMax = items.reduce((s, i) => s + i.max, 0) || 1;
  const slices = items.flatMap((item) => [
    { name: item.name, value: item.value, fill: item.color },
    { name: `${item.name} offen`, value: Math.max(0, item.max - item.value), fill: "var(--muted)" },
  ]);
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={slices}
            dataKey="value"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            paddingAngle={3}
            cornerRadius={99}
            stroke="none"
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="text-3xl font-semibold tabular-nums">
          {Math.round((total / totalMax) * 100)}
        </span>
      </div>
    </div>
  );
}
