import { type ReactNode, useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Sankey,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  type ChartKind,
  type DatasetShape,
  fmtCompact,
  fmtNumber,
  PALETTE,
  toLabel,
  toNumber,
  type WidgetOptions,
} from "@/lib/dashboards";

type Row = Record<string, unknown>;

export interface ChartProps {
  rows: Row[];
  shape: DatasetShape;
  options: WidgetOptions;
}

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--card-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.08)",
} as const;

function color(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function categories(rows: Row[], shape: DatasetShape, offset = 0, metricIndex = 0) {
  const key = shape.metrics[metricIndex]?.key ?? "";
  return rows.map((row, i) => ({
    name: shape.dimension ? toLabel(row[shape.dimension]) : `#${i + 1}`,
    value: toNumber(row[key]),
    color: color(i + offset),
  }));
}

function series(rows: Row[], shape: DatasetShape) {
  return rows.map((row) => {
    const out: Row = { name: shape.dimension ? toLabel(row[shape.dimension]) : "" };
    for (const m of shape.metrics) out[m.key] = toNumber(row[m.key]);
    return out;
  });
}

export function LegendCards({
  items,
  columns = 3,
}: {
  items: { name: string; value: string; color: string }[];
  columns?: number;
}) {
  if (!items.length) return null;
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.min(columns, items.length)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.name} className="min-w-0 rounded-xl border bg-background/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full" style={{ background: item.color }} />
            <span className="truncate">{item.name}</span>
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function AreaStacked({ rows, shape, options }: ChartProps) {
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

function Bars({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col justify-center gap-2.5">
        {items.map((item) => {
          const pct = (item.value / max) * 100;
          return (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(56px,auto)_1fr_auto] items-center gap-3 text-xs"
            >
              <span className="truncate text-right text-muted-foreground">{item.name}</span>
              <div className="relative h-4 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(pct, 4)}%`, background: item.color }}
                />
                <span
                  className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `calc(${Math.max(pct, 4)}% - 16px)`, background: item.color }}
                />
              </div>
              <span className="tabular-nums">
                <span className="font-semibold">{fmtNumber(item.value)}</span>
                <span className="ml-1.5 text-muted-foreground">{Math.round(pct)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Funnel({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset);
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((i) => i.value));
  const n = items.length;
  const segW = 100 / n;
  const bridge = Math.min(12, segW * 0.28);
  const heights = items.map((i) => Math.max(8, (i.value / max) * 100));
  const paths = items.map((_, i) => {
    const h = heights[i];
    const x0 = i * segW;
    const x1 = x0 + segW;
    const top = 50 - h / 2;
    const bottom = 50 + h / 2;
    const prev = i > 0 ? heights[i - 1] : h;
    const ptop = 50 - prev / 2;
    const pbottom = 50 + prev / 2;
    const c = x0 + bridge / 2;
    return `M ${x0} ${ptop} C ${c} ${ptop} ${c} ${top} ${x0 + bridge} ${top} L ${x1} ${top} L ${x1} ${bottom} L ${x0 + bridge} ${bottom} C ${c} ${bottom} ${c} ${pbottom} ${x0} ${pbottom} Z`;
  });
  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Funnel"
      >
        {paths.map((d, i) => (
          <g key={items[i].name}>
            <path d={d} fill={items[i].color} opacity={0.18} transform="translate(0 0)" />
            <path d={d} fill={items[i].color} transform="scale(1 0.8) translate(0 12.5)" />
          </g>
        ))}
      </svg>
      {items.map((item, i) => (
        <span
          key={item.name}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-border/60"
          style={{ left: `${i * segW + segW / 2}%`, top: "50%" }}
        >
          {options.showPercent
            ? `${Math.round((item.value / max) * 100)}%`
            : fmtCompact(item.value)}
        </span>
      ))}
    </div>
  );
}

function Rings({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset)
    .sort((a, b) => a.value - b.value)
    .map((item) => ({ ...item, fill: item.color }));
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadialBarChart
        data={items}
        innerRadius="35%"
        outerRadius="100%"
        startAngle={90}
        endAngle={-270}
        barCategoryGap="18%"
      >
        <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
        <RadialBar
          isAnimationActive={false}
          dataKey="value"
          background={{ fill: "var(--muted)" }}
          cornerRadius={99}
          label={false}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(toNumber(v))} />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

function RadarNet({ rows, shape, options }: ChartProps) {
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

function Bubbles({ rows, shape, options }: ChartProps) {
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

function Flow({ rows, shape, options }: ChartProps) {
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

function Score({ rows, shape, options }: ChartProps) {
  const [mv, mm] = shape.metrics;
  const items = rows.map((row, i) => ({
    name: shape.dimension ? toLabel(row[shape.dimension]) : `#${i + 1}`,
    value: toNumber(row[mv?.key ?? ""]),
    max: Math.max(toNumber(row[mm?.key ?? ""]), toNumber(row[mv?.key ?? ""]), 0),
    color: color(i + options.colorOffset),
  }));
  const total = items.reduce((s, i) => s + i.value, 0);
  const totalMax = items.reduce((s, i) => s + i.max, 0) || 1;
  const slices = items.flatMap((item) => [
    { name: item.name, value: item.value, fill: item.color },
    { name: `${item.name} offen`, value: Math.max(0, item.max - item.value), fill: "var(--muted)" },
  ]);
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={slices}
            dataKey="value"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            paddingAngle={3}
            cornerRadius={99}
            stroke="none"
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="text-3xl font-semibold tabular-nums">
          {Math.round((total / totalMax) * 100)}
        </span>
      </div>
    </div>
  );
}

function Kpi({ rows, shape, options }: ChartProps) {
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

function Lines({ rows, shape, options }: ChartProps) {
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

function Columns({ rows, shape, options }: ChartProps) {
  const data = series(rows, shape);
  const single = shape.metrics.length === 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 12, right: 8, left: -12, bottom: 0 }}
        barCategoryGap="25%"
      >
        {options.showGrid && (
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        )}
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={axisTick} minTickGap={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={fmtCompact}
          width={48}
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
                position="top"
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

function Donut({ rows, shape, options }: ChartProps) {
  const items = categories(rows, shape, options.colorOffset).map((c) => ({ ...c, fill: c.color }));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={items}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="95%"
            paddingAngle={3}
            cornerRadius={8}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) =>
              options.showPercent
                ? `${fmtNumber(toNumber(v))} · ${Math.round((toNumber(v) / total) * 100)}%`
                : fmtNumber(toNumber(v))
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtCompact(total)}</div>
          <div className="text-[11px] text-muted-foreground">Gesamt</div>
        </div>
      </div>
    </div>
  );
}

function GaugeChart({ rows, shape, options }: ChartProps) {
  const [mv, mm] = shape.metrics;
  const value = rows.reduce((s, r) => s + toNumber(r[mv?.key ?? ""]), 0);
  const max = rows.reduce((s, r) => s + toNumber(r[mm?.key ?? ""]), 0) || 1;
  const pct = Math.max(0, Math.min(1, value / max));
  const data = [
    { name: "Wert", value: pct, fill: color(options.colorOffset) },
    { name: "Rest", value: 1 - pct, fill: "var(--muted)" },
  ];
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={data}
            dataKey="value"
            startAngle={200}
            endAngle={-20}
            innerRadius="68%"
            outerRadius="100%"
            cornerRadius={99}
            paddingAngle={2}
            stroke="none"
            cy="60%"
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[42%] text-center">
        <div className="text-2xl font-semibold tabular-nums">{Math.round(pct * 100)}%</div>
        <div className="text-[11px] text-muted-foreground">
          {fmtCompact(value)} von {fmtCompact(max)}
        </div>
      </div>
    </div>
  );
}

function TreemapChart({ rows, shape, options }: ChartProps) {
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

function Heatmap({ rows, shape, options }: ChartProps) {
  const metric = shape.metrics[0]?.key ?? "";
  const xs: string[] = [];
  const ys: string[] = [];
  const cells = new Map<string, number>();
  for (const row of rows) {
    const y = toLabel(row[shape.dimension ?? ""]);
    const x = toLabel(row[shape.dimension2 ?? ""]);
    if (!xs.includes(x)) xs.push(x);
    if (!ys.includes(y)) ys.push(y);
    cells.set(`${y}|${x}`, (cells.get(`${y}|${x}`) ?? 0) + toNumber(row[metric]));
  }
  const max = Math.max(1, ...cells.values());
  const base = color(options.colorOffset);
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th />
            {xs.map((x) => (
              <th
                key={x}
                className="truncate px-1 pb-1 text-center font-medium text-muted-foreground"
              >
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((y) => (
            <tr key={y}>
              <th className="truncate pr-2 text-right font-medium text-muted-foreground">{y}</th>
              {xs.map((x) => {
                const v = cells.get(`${y}|${x}`) ?? 0;
                const alpha = v ? 0.15 + (v / max) * 0.85 : 0.05;
                return (
                  <td
                    key={x}
                    title={`${y} × ${x}: ${fmtNumber(v)}`}
                    className="h-8 rounded-md text-center tabular-nums"
                    style={{
                      background: `color-mix(in srgb, ${base} ${Math.round(alpha * 100)}%, transparent)`,
                    }}
                  >
                    {options.labels && v ? fmtCompact(v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataTable({ rows, shape }: ChartProps) {
  const columns = [
    ...(shape.dimension ? [{ key: shape.dimension, label: "Aufteilung" }] : []),
    ...(shape.dimension2 ? [{ key: shape.dimension2, label: "Zweite Aufteilung" }] : []),
    ...shape.metrics,
  ];
  const keys = columns.length
    ? columns
    : Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }));
  return (
    <div className="h-full overflow-auto rounded-xl border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            {keys.map((c) => (
              <th key={c.key} className="border-b px-2.5 py-1.5 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(i)} className="border-b border-border/50 last:border-0">
              {keys.map((c) => (
                <td key={c.key} className="max-w-48 truncate px-2.5 py-1.5 tabular-nums">
                  {toLabel(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CHART_RENDERERS: Record<ChartKind, (props: ChartProps) => ReactNode> = {
  kpi: Kpi,
  area: AreaStacked,
  line: Lines,
  column: Columns,
  bars: Bars,
  funnel: Funnel,
  donut: Donut,
  rings: Rings,
  radar: RadarNet,
  scatter: Bubbles,
  sankey: Flow,
  score: Score,
  gauge: GaugeChart,
  treemap: TreemapChart,
  heatmap: Heatmap,
  table: DataTable,
};

export function legendFor(
  kind: ChartKind,
  rows: Row[],
  shape: DatasetShape,
  options: WidgetOptions,
) {
  const sum = (key: string) => rows.reduce((s, r) => s + toNumber(r[key]), 0);
  switch (kind) {
    case "area":
      return shape.metrics.map((m, i) => ({
        name: m.label,
        value: fmtNumber(sum(m.key)),
        color: color(i + options.colorOffset),
      }));
    case "scatter": {
      const y = shape.metrics[1]?.key ?? "";
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = shape.dimension ? toLabel(r[shape.dimension]) : "Alle";
        groups.set(k, [...(groups.get(k) ?? []), toNumber(r[y])]);
      }
      return [...groups.entries()].map(([name, list], i) => ({
        name: `${name} · Ø`,
        value: fmtNumber(list.reduce((s, v) => s + v, 0) / Math.max(1, list.length)),
        color: color(i + options.colorOffset),
      }));
    }
    case "score": {
      const [mv, mm] = shape.metrics;
      return rows.map((r, i) => ({
        name: shape.dimension ? toLabel(r[shape.dimension]) : `#${i + 1}`,
        value: `${fmtNumber(toNumber(r[mv?.key ?? ""]))}/${fmtNumber(toNumber(r[mm?.key ?? ""]))}`,
        color: color(i + options.colorOffset),
      }));
    }
    case "kpi":
    case "sankey":
    case "gauge":
    case "heatmap":
    case "table":
      return [];
    default:
      return categories(rows, shape, options.colorOffset).map((c) => ({
        ...c,
        value: fmtNumber(c.value),
      }));
  }
}

export function headlineFor(kind: ChartKind, rows: Row[], shape: DatasetShape): string {
  if (kind === "table") return `${rows.length} Zeilen`;
  const key = shape.metrics[0]?.key ?? "";
  if (!rows.length || !key) return "—";
  if (kind === "gauge") {
    const max = rows.reduce((s, r) => s + toNumber(r[shape.metrics[1]?.key ?? ""]), 0) || 1;
    return `${Math.round((rows.reduce((s, r) => s + toNumber(r[key]), 0) / max) * 100)}%`;
  }
  if (kind === "score") {
    const total = rows.reduce((s, r) => s + toNumber(r[key]), 0);
    const max = rows.reduce((s, r) => s + toNumber(r[shape.metrics[1]?.key ?? ""]), 0) || 1;
    const pct = Math.round((total / max) * 100);
    return pct >= 90 ? "Exzellent" : pct >= 70 ? "Gut" : pct >= 50 ? "Okay" : "Schwach";
  }
  if (kind === "scatter") {
    const y = shape.metrics[1]?.key ?? key;
    return fmtNumber(rows.reduce((s, r) => s + toNumber(r[y]), 0) / rows.length);
  }
  if (kind === "funnel" || kind === "bars")
    return fmtNumber(Math.max(...rows.map((r) => toNumber(r[key]))));
  if (kind === "kpi" && !shape.dimension) return fmtNumber(toNumber(rows[0][key]));
  const keys =
    kind === "area" || kind === "line" || kind === "column" || kind === "radar"
      ? shape.metrics.map((m) => m.key)
      : [key];
  return fmtNumber(rows.reduce((s, r) => s + keys.reduce((t, k) => t + toNumber(r[k]), 0), 0));
}

export function deltaFor(rows: Row[], shape: DatasetShape, isTime: boolean): number | null {
  const key = shape.metrics[0]?.key ?? "";
  if (!isTime || rows.length < 2 || !key) return null;
  const last = toNumber(rows[rows.length - 1][key]);
  const prev = toNumber(rows[rows.length - 2][key]);
  if (!prev) return null;
  return ((last - prev) / Math.abs(prev)) * 100;
}
