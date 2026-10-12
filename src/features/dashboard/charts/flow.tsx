import { useState } from "react";
import { fmtValue, fmtValueCompact, OTHER_LABEL, toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { CHAR_WIDTH, type ChartProps, color, hoveredIndex, OTHER_COLOR } from "./chart-utils";

const NODE_WIDTH = 8;
const MARGIN_Y = 8;
const LABEL_GAP = 8;
const FONT_CHAR = CHAR_WIDTH * (12 / 11);
const LEFT = { slot: 30, pad: 8, share: 0.3 };
const RIGHT = { slot: 16, pad: 6, share: 0.32 };
const MUTED = "var(--muted-foreground)";

type Side = typeof LEFT;
type Link = { source: string; target: string; value: number };
type Node = { name: string; value: number; y: number; height: number; offset: number };

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function totalsBy(links: Link[], key: "source" | "target") {
  const totals = new Map<string, number>();
  for (const l of links) totals.set(l[key], (totals.get(l[key]) ?? 0) + l.value);
  return totals;
}

function grouping(totals: Map<string, number>, max: number) {
  if (totals.size <= max) return { of: (name: string) => name, other: null };
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  const top = new Set(ranked.slice(0, max - 1).map(([name]) => name));
  const other = `${OTHER_LABEL} (${ranked.length - top.size})`;
  return { of: (name: string) => (top.has(name) ? name : other), other };
}

function ordered(totals: Map<string, number>, other: string | null) {
  return [...totals]
    .sort((a, b) => Number(a[0] === other) - Number(b[0] === other) || b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

function used(values: number[], k: number, side: Side) {
  return (
    values.reduce((s, v) => s + Math.max(v * k, side.slot), 0) + side.pad * (values.length - 1)
  );
}

function fitScale(values: number[], inner: number, side: Side, total: number) {
  let low = 0;
  let high = inner / total;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (used(values, mid, side) <= inner) low = mid;
    else high = mid;
  }
  return low;
}

function layoutColumn(
  items: { name: string; value: number }[],
  k: number,
  side: Side,
  inner: number,
) {
  let y =
    MARGIN_Y +
    Math.max(
      0,
      (inner -
        used(
          items.map((n) => n.value),
          k,
          side,
        )) /
        2,
    );
  return new Map(
    items.map(({ name, value }) => {
      const height = Math.max(1, value * k);
      const slot = Math.max(height, side.slot);
      const node: Node = { name, value, y: y + (slot - height) / 2, height, offset: 0 };
      y += slot + side.pad;
      return [name, node];
    }),
  );
}

export function Flow({ rows, shape, options }: ChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const metric = shape.metrics[0]?.key ?? "";
  const raw = rows
    .map((row) => ({
      source: toLabel(row[shape.dimension ?? ""]),
      target: toLabel(row[shape.dimension2 ?? ""]),
      value: toNumber(row[metric]),
    }))
    .filter((l) => l.value > 0 && l.source !== l.target);
  if (!raw.length) return null;
  const inner = Math.max(0, height - MARGIN_Y * 2);
  const capacity = (side: Side) =>
    Math.max(2, Math.floor((inner + side.pad) / (side.slot + side.pad)));
  const sourceGroups = grouping(totalsBy(raw, "source"), capacity(LEFT));
  const targetGroups = grouping(totalsBy(raw, "target"), capacity(RIGHT));
  const merged = new Map<string, Link>();
  for (const l of raw) {
    const source = sourceGroups.of(l.source);
    const target = targetGroups.of(l.target);
    const key = JSON.stringify([source, target]);
    const link = merged.get(key) ?? { source, target, value: 0 };
    link.value += l.value;
    merged.set(key, link);
  }
  const sources = ordered(totalsBy([...merged.values()], "source"), sourceGroups.other);
  const targets = ordered(totalsBy([...merged.values()], "target"), targetGroups.other);
  const rank = (list: { name: string }[]) => new Map(list.map((n, i) => [n.name, i]));
  const sourceRank = rank(sources);
  const targetRank = rank(targets);
  const links = [...merged.values()].sort(
    (a, b) =>
      (sourceRank.get(a.source) ?? 0) - (sourceRank.get(b.source) ?? 0) ||
      (targetRank.get(a.target) ?? 0) - (targetRank.get(b.target) ?? 0),
  );
  const total = links.reduce((s, l) => s + l.value, 0);
  const k = Math.min(
    fitScale(
      sources.map((n) => n.value),
      inner,
      LEFT,
      total,
    ),
    fitScale(
      targets.map((n) => n.value),
      inner,
      RIGHT,
      total,
    ),
  );
  const left = layoutColumn(sources, k, LEFT, inner);
  const right = layoutColumn(targets, k, RIGHT, inner);
  const percent = (value: number) => ` · ${Math.round((value / total) * 100)}%`;
  const leftChars = Math.floor((width * LEFT.share) / FONT_CHAR);
  const rightChars = Math.floor((width * RIGHT.share) / FONT_CHAR);
  const leftText = (node: Node) => clip(node.name, leftChars);
  const rightText = (node: Node) => clip(node.name, rightChars - percent(node.value).length);
  const textWidth = (texts: string[]) => Math.max(0, ...texts.map((t) => t.length)) * FONT_CHAR;
  const x0 =
    textWidth([
      ...[...left.values()].map(leftText),
      ...[...left.values()].map((n) => fmtValueCompact(n.value, options)),
    ]) +
    LABEL_GAP +
    2;
  const x1 =
    width -
    NODE_WIDTH -
    LABEL_GAP -
    2 -
    textWidth([...right.values()].map((n) => rightText(n) + percent(n.value)));
  const mid = (x0 + NODE_WIDTH + x1) / 2;
  const sourceColor = (name: string) =>
    name === sourceGroups.other
      ? OTHER_COLOR
      : color((sourceRank.get(name) ?? 0) + options.colorOffset);
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
              stroke={sourceColor(link.source)}
              strokeOpacity={hover === i ? 0.6 : 0.35}
              strokeWidth={Math.max(1, thickness)}
            />
          ))}
          {[...left.values()].map((node) => {
            const text = leftText(node);
            return (
              <g key={`s-${node.name}`}>
                <rect
                  x={x0}
                  y={node.y}
                  width={NODE_WIDTH}
                  height={node.height}
                  rx={3}
                  fill={sourceColor(node.name)}
                />
                <text
                  x={x0 - LABEL_GAP}
                  y={node.y + node.height / 2 - 6}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill="var(--card-foreground)"
                >
                  {text !== node.name && <title>{node.name}</title>}
                  {text}
                </text>
                <text
                  x={x0 - LABEL_GAP}
                  y={node.y + node.height / 2 + 12}
                  textAnchor="end"
                  fontSize={11}
                  fill={MUTED}
                >
                  {fmtValueCompact(node.value, options)}
                </text>
              </g>
            );
          })}
          {[...right.values()].map((node) => {
            const text = rightText(node);
            return (
              <g key={`t-${node.name}`}>
                <rect
                  x={x1}
                  y={node.y}
                  width={NODE_WIDTH}
                  height={node.height}
                  rx={3}
                  fill={MUTED}
                  fillOpacity={0.45}
                />
                <text
                  x={x1 + NODE_WIDTH + LABEL_GAP}
                  y={node.y + node.height / 2}
                  dominantBaseline="middle"
                  fontSize={12}
                  fill="var(--card-foreground)"
                >
                  {text !== node.name && <title>{node.name}</title>}
                  {text}
                  <tspan fill={MUTED}>{percent(node.value)}</tspan>
                </text>
              </g>
            );
          })}
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
              value: fmtValue(hovered.link.value, options),
              color: sourceColor(hovered.link.source),
            },
          ]}
        />
      )}
    </div>
  );
}
