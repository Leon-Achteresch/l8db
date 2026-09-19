import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { axisTick, type ChartProps, color, type Row, tooltipStyle } from "./chart-utils";

export function Bubbles({ rows, shape, options }: ChartProps) {
  const [mx, my, mz] = shape.metrics;
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = shape.dimension ? toLabel(row[shape.dimension]) : "Alle";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        {options.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />}
        <XAxis
          type="number"
          dataKey="x"
          name={mx?.label}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={fmtCompact}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={my?.label}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={fmtCompact}
          width={48}
        />
        {mz && <ZAxis type="number" dataKey="z" range={[60, 600]} name={mz.label} />}
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
        {[...groups.entries()].map(([name, list], i) => (
          <Scatter
            isAnimationActive={false}
            key={name}
            name={name}
            data={list.map((r) => ({
              x: toNumber(r[mx?.key ?? ""]),
              y: toNumber(r[my?.key ?? ""]),
              z: mz ? toNumber(r[mz.key]) : 1,
            }))}
            fill={color(i + options.colorOffset)}
            fillOpacity={0.85}
            stroke={color(i + options.colorOffset)}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
