import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtNumber, toNumber } from "@/lib/dashboards";
import { axisTick, type ChartProps, color, series, tooltipStyle } from "./chart-utils";

export function Columns({ rows, shape, options }: ChartProps) {
  const data = series(rows, shape);
  const single = shape.metrics.length === 1;
  const horizontal = options.horizontal;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout={horizontal ? "vertical" : "horizontal"}
        data={data}
        margin={{ top: 12, right: 8, left: -12, bottom: 0 }}
        barCategoryGap="25%"
      >
        {options.showGrid && (
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        )}
        <XAxis
          dataKey={horizontal ? undefined : "name"}
          type={horizontal ? "number" : "category"}
          tickFormatter={horizontal ? fmtCompact : undefined}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          minTickGap={8}
        />
        <YAxis
          type={horizontal ? "category" : "number"}
          dataKey={horizontal ? "name" : undefined}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={horizontal ? undefined : fmtCompact}
          width={horizontal ? 96 : 48}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          contentStyle={tooltipStyle}
          formatter={(v) => fmtNumber(toNumber(v))}
        />
        {shape.metrics.map((m, i) => (
          <Bar
            isAnimationActive={false}
            key={m.key}
            dataKey={m.key}
            name={m.label}
            stackId={options.stacked ? "a" : undefined}
            fill={color(i + options.colorOffset)}
            radius={options.stacked && i < shape.metrics.length - 1 ? 0 : 6}
          >
            {single &&
              data.map((_, j) => <Cell key={String(j)} fill={color(j + options.colorOffset)} />)}
            {options.labels && (
              <LabelList
                dataKey={m.key}
                position={horizontal ? "right" : "top"}
                fontSize={10}
                formatter={(v) => fmtCompact(toNumber(v))}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
