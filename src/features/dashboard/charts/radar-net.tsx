import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { fmtNumber, toNumber } from "@/lib/dashboards";
import { axisTick, type ChartProps, color, series, tooltipStyle } from "./chart-utils";

export function RadarNet({ rows, shape, options }: ChartProps) {
  const data = series(rows, shape);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="62%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="name" tick={axisTick} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        {shape.metrics.map((m, i) => (
          <Radar
            isAnimationActive={false}
            key={m.key}
            dataKey={m.key}
            name={m.label}
            stroke={color(i + options.colorOffset)}
            strokeWidth={2}
            fill={color(i + options.colorOffset)}
            fillOpacity={0.3}
            dot={{ r: 2, fill: color(i + options.colorOffset) }}
          />
        ))}
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
