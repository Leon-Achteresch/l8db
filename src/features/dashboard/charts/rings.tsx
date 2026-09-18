import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtNumber, toNumber } from "@/lib/dashboards";
import { type ChartProps, categories, tooltipStyle } from "./chart-utils";

export function Rings({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset)
    .sort((a, b) => a.value - b.value)
    .map((item) => ({ ...item, fill: item.color }));
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadialBarChart
        data={items}
        innerRadius="35%"
        outerRadius="100%"
        startAngle={90}
        endAngle={-270}
        barCategoryGap="18%"
      >
        <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
        <RadialBar
          isAnimationActive={false}
          dataKey="value"
          background={{ fill: "var(--muted)" }}
          cornerRadius={99}
          label={false}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}
