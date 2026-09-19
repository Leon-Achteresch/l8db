import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtNumber, toNumber } from "@/lib/dashboards";
import { axisTick, type ChartProps, color, series, tooltipStyle } from "./chart-utils";

export function Lines({ rows, shape, options }: ChartProps) {
  const data = series(rows, shape);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        {options.showGrid && (
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        )}
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={axisTick} minTickGap={16} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={fmtCompact}
          width={48}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
        {shape.metrics.map((m, i) => (
          <Line
            isAnimationActive={false}
            key={m.key}
            type={options.curve}
            dataKey={m.key}
            name={m.label}
            stroke={color(i + options.colorOffset)}
            strokeWidth={2.5}
            dot={{ r: 3, fill: color(i + options.colorOffset), strokeWidth: 0 }}
          >
            {options.labels && (
              <LabelList
                dataKey={m.key}
                position="top"
                fontSize={10}
                formatter={(v) => fmtCompact(toNumber(v))}
              />
            )}
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
