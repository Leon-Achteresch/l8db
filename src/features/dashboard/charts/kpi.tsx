import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { toNumber } from "@/lib/dashboards";
import { type ChartProps, color } from "./chart-utils";

export function Kpi({ rows, shape, options }: ChartProps) {
  const uid = useId();
  const key = shape.metrics[0]?.key ?? "";
  if (!shape.dimension || rows.length < 2) return null;
  const data = rows.map((r) => ({ v: toNumber(r[key]) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`kpi-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color(options.colorOffset)} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color(options.colorOffset)} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <Area
          isAnimationActive={false}
          type={options.curve}
          dataKey="v"
          stroke={color(options.colorOffset)}
          strokeWidth={2}
          fill={`url(#kpi-fill-${uid})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
