import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { fmtCompact, fmtNumber, toNumber } from "@/lib/dashboards";
import { type ChartProps, categories, tooltipStyle } from "./chart-utils";

export function TreemapChart({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset).filter((i) => i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={items}
        dataKey="value"
        nameKey="name"
        isAnimationActive={false}
        content={(props: {
          x: number;
          y: number;
          width: number;
          height: number;
          index: number;
          name?: string;
          value?: number;
        }) => {
          const { x, y, width, height, index, name, value } = props;
          const item = items[index];
          if (!item) return <g />;
          const roomy = width > 56 && height > 34;
          return (
            <g>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={8}
                fill={item.color}
                stroke="var(--card)"
                strokeWidth={3}
              />
              {roomy && (
                <text x={x + 10} y={y + 18} fontSize={11} fontWeight={600} fill="rgb(0 0 0 / 0.75)">
                  {name}
                </text>
              )}
              {roomy && options.labels && (
                <text x={x + 10} y={y + 34} fontSize={11} fill="rgb(0 0 0 / 0.6)">
                  {fmtCompact(toNumber(value))} · {Math.round((toNumber(value) / total) * 100)}%
                </text>
              )}
            </g>
          );
        }}
      >
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
      </Treemap>
    </ResponsiveContainer>
  );
}
