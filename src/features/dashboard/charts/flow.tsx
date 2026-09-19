import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { type ChartProps, color, tooltipStyle } from "./chart-utils";

export function Flow({ rows, shape, options }: ChartProps) {
  const metric = shape.metrics[0]?.key ?? "";
  const names: string[] = [];
  const index = (name: string) => {
    const i = names.indexOf(name);
    if (i >= 0) return i;
    names.push(name);
    return names.length - 1;
  };
  const sourceIndex = (name: string) => names.filter((n) => !n.startsWith("→ ")).indexOf(name);
  const links = rows
    .map((row) => ({
      source: `${toLabel(row[shape.dimension ?? ""])}`,
      target: `→ ${toLabel(row[shape.dimension2 ?? ""])}`,
      value: toNumber(row[metric]),
    }))
    .filter((l) => l.value > 0 && l.source !== l.target)
    .map((l) => ({ source: index(l.source), target: index(l.target), value: l.value }));
  if (!links.length) return null;
  const total = links.reduce((s, l) => s + l.value, 0);
  const data = { nodes: names.map((name) => ({ name })), links };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Sankey
        data={data}
        nodePadding={18}
        nodeWidth={8}
        margin={{ top: 8, right: 110, bottom: 8, left: 90 }}
        link={(props: {
          sourceX: number;
          targetX: number;
          sourceY: number;
          targetY: number;
          sourceControlX: number;
          targetControlX: number;
          linkWidth: number;
          payload: { source: { name: string } };
        }) => {
          const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth } =
            props;
          const i = sourceIndex(props.payload.source.name);
          return (
            <path
              d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
              fill="none"
              stroke={color(i + options.colorOffset)}
              strokeOpacity={0.35}
              strokeWidth={Math.max(1, linkWidth)}
            />
          );
        }}
        node={(props: {
          x: number;
          y: number;
          width: number;
          height: number;
          index: number;
          payload: { name: string; value: number; sourceLinks: unknown[] };
        }) => {
          const { x, y, width, height, payload } = props;
          const isSource = !payload.name.startsWith("→ ");
          const label = payload.name.replace(/^→ /, "");
          const i = sourceIndex(payload.name);
          return (
            <g>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={3}
                fill={isSource ? color(i + options.colorOffset) : "var(--muted-foreground)"}
                fillOpacity={isSource ? 1 : 0.45}
              />
              <text
                x={isSource ? x - 8 : x + width + 8}
                y={y + height / 2}
                textAnchor={isSource ? "end" : "start"}
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--card-foreground)"
              >
                {label}
                <tspan fill="var(--muted-foreground)">
                  {isSource ? "" : ` · ${Math.round((payload.value / total) * 100)}%`}
                </tspan>
              </text>
              {isSource && (
                <text
                  x={x - 8}
                  y={y + height / 2 + 14}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {fmtCompact(payload.value)}
                </text>
              )}
            </g>
          );
        }}
      >
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
      </Sankey>
    </ResponsiveContainer>
  );
}
