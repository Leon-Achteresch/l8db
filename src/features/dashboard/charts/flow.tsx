import { useState } from "react";
import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { type ChartProps, color, hoveredIndex } from "./chart-utils";

const NODE_WIDTH = 8;
const NODE_PADDING = 18;
const MARGIN = { top: 8, right: 110, bottom: 8, left: 90 };

type Node = { name: string; value: number; y: number; height: number; offset: number };

function layoutColumn(names: string[], values: Map<string, number>, k: number, top: number) {
  let y = top;
  return new Map(
    names.map((name) => {
      const value = values.get(name) ?? 0;
      const node: Node = { name, value, y, height: Math.max(1, value * k), offset: 0 };
      y += node.height + NODE_PADDING;
      return [name, node];
    }),
  );
}

export function Flow({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const metric = shape.metrics[0]?.key ?? "";
  const links = rows
    .map((row) => ({
      source: toLabel(row[shape.dimension ?? ""]),
      target: toLabel(row[shape.dimension2 ?? ""]),
      value: toNumber(row[metric]),
    }))
    .filter((l) => l.value > 0 && l.source !== l.target);
  if (!links.length) return null;
  const sources = [...new Set(links.map((l) => l.source))];
  const targets = [...new Set(links.map((l) => l.target))];
  const sum = (key: "source" | "target") => {
    const totals = new Map<string, number>();
    for (const l of links) totals.set(l[key], (totals.get(l[key]) ?? 0) + l.value);
    return totals;
  };
  const sourceTotals = sum("source");
  const targetTotals = sum("target");
  const total = links.reduce((s, l) => s + l.value, 0);
  const inner = height - MARGIN.top - MARGIN.bottom;
  const k = Math.max(
    0,
    Math.min(
      (inner - NODE_PADDING * (sources.length - 1)) / total,
      (inner - NODE_PADDING * (targets.length - 1)) / total,
    ),
  );
  const left = layoutColumn(sources, sourceTotals, k, MARGIN.top);
  const right = layoutColumn(targets, targetTotals, k, MARGIN.top);
  const x0 = MARGIN.left;
  const x1 = width - MARGIN.right - NODE_WIDTH;
  const mid = (x0 + NODE_WIDTH + x1) / 2;
  const paths = links.map((l) => {
    const from = left.get(l.source) as Node;
    const to = right.get(l.target) as Node;
    const thickness = l.value * k;
    const sy = from.y + from.offset + thickness / 2;
    const ty = to.y + to.offset + thickness / 2;
    from.offset += thickness;
    to.offset += thickness;
    return { link: l, sy, ty, thickness };
  });
  const hovered = hover !== null ? paths[hover] : undefined;

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => setHover(hoveredIndex(event.target))}
        >
          {paths.map(({ link, sy, ty, thickness }, i) => (
            <path
              key={`${link.source}→${link.target}`}
              data-index={i}
              d={`M${x0 + NODE_WIDTH},${sy}C${mid},${sy} ${mid},${ty} ${x1},${ty}`}
              fill="none"
              stroke={color(sources.indexOf(link.source) + options.colorOffset)}
              strokeOpacity={hover === i ? 0.6 : 0.35}
              strokeWidth={Math.max(1, thickness)}
            />
          ))}
          {[...left.values()].map((node, i) => (
            <g key={`s-${node.name}`}>
              <rect
                x={x0}
                y={node.y}
                width={NODE_WIDTH}
                height={node.height}
                rx={3}
                fill={color(i + options.colorOffset)}
              />
              <text
                x={x0 - 8}
                y={node.y + node.height / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--card-foreground)"
              >
                {node.name}
              </text>
              <text
                x={x0 - 8}
                y={node.y + node.height / 2 + 14}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {fmtCompact(node.value)}
              </text>
            </g>
          ))}
          {[...right.values()].map((node) => (
            <g key={`t-${node.name}`}>
              <rect
                x={x1}
                y={node.y}
                width={NODE_WIDTH}
                height={node.height}
                rx={3}
                fill="var(--muted-foreground)"
                fillOpacity={0.45}
              />
              <text
                x={x1 + NODE_WIDTH + 8}
                y={node.y + node.height / 2}
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--card-foreground)"
              >
                {node.name}
                <tspan fill="var(--muted-foreground)">
                  {` · ${Math.round((node.value / total) * 100)}%`}
                </tspan>
              </text>
            </g>
          ))}
        </svg>
      )}
      {hovered && (
        <ChartTooltip
          x={mid}
          y={(hovered.sy + hovered.ty) / 2}
          width={width}
          entries={[
            {
              label: `${hovered.link.source} → ${hovered.link.target}`,
              value: fmtNumber(hovered.link.value),
              color: color(sources.indexOf(hovered.link.source) + options.colorOffset),
            },
          ]}
        />
      )}
    </div>
  );
}
