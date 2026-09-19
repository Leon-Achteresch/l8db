import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtNumber, toNumber } from "@/lib/dashboards";
import { axisTick, type ChartProps, color, series, tooltipStyle } from "./chart-utils";

export function AreaStacked({ rows, shape, options }: ChartProps) {
  const uid = useId();
  const data = series(rows, shape);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {shape.metrics.map((m, i) => (
            <linearGradient
              key={m.key}
              id={`fill-${uid}-${m.key}-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color(i + options.colorOffset)} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color(i + options.colorOffset)} stopOpacity={0.08} />
            </linearGradient>
          ))}
        </defs>
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
          <Area
            isAnimationActive={false}
            key={m.key}
            type={options.curve}
            dataKey={m.key}
            name={m.label}
            stackId={options.stacked ? "a" : undefined}
            stroke={color(i + options.colorOffset)}
            strokeWidth={2}
            fill={`url(#fill-${uid}-${m.key}-${i})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
