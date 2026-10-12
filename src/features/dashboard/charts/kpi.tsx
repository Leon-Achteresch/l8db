import { useId, useState } from "react";
import { COMPARE_COLOR, fmtValue, fmtValueCompact, toLabel, toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { ChartTooltip } from "./chart-tooltip";
import { accent, type ChartProps, dimensionLabels } from "./chart-utils";
import { curvePath, type Point, scale } from "./svg-geometry";
import { TargetLine } from "./target-line";

export function Kpi({ rows, shape, options, compare }: ChartProps) {
  const uid = useId();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const key = shape.metrics[0]?.key ?? "";
  if (!shape.dimension || rows.length < 2)
    return (
      <div className="grid h-full place-items-center px-2 text-center text-xs text-pretty text-muted-foreground">
        Kein Verlauf: Die Daten enthalten nur einen Zeitpunkt. Für Sparkline und Trend braucht der
        KPI eine Zeile pro Tag, Woche oder Monat.
      </div>
    );
  const values = rows.map((r) => toNumber(r[key]));
  const ghost = compare?.values ?? [];
  const all = [
    ...values,
    ...ghost.filter((v): v is number => v !== null),
    ...(options.target !== null ? [options.target] : []),
  ];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const pad = (high - low) * 0.12 || Math.abs(high) * 0.1 || 1;
  const y = scale([low - pad, high + pad], [height - 2, 6]);
  const x = (i: number) => 4 + (i * (width - 12)) / (values.length - 1);
  const points = values.map((v, i): Point => [x(i), y(v)]);
  const ghostPoints = ghost.flatMap((v, i): Point[] => (v === null ? [] : [[x(i), y(v)]]));
  const line = curvePath(points, options.curve);
  const stroke = accent(options);
  const last = points[points.length - 1];
  const names = dimensionLabels(rows.map((r) => toLabel(r[shape.dimension as string])));
  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg
          className="chart-surface"
          width={width}
          height={height}
          aria-hidden="true"
          onMouseMove={(event) => {
            const offset = event.clientX - event.currentTarget.getBoundingClientRect().left;
            const index = Math.round(((offset - 4) / (width - 12)) * (values.length - 1));
            setHover(Math.max(0, Math.min(values.length - 1, index)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`kpi-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ghostPoints.length > 1 ? (
            <path
              d={curvePath(ghostPoints, options.curve)}
              fill="none"
              stroke={COMPARE_COLOR}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ) : (
            <path
              d={`${line}L${last[0]},${height}L${points[0][0]},${height}Z`}
              fill={`url(#kpi-fill-${uid})`}
            />
          )}
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {options.target !== null && (
            <TargetLine
              box={{ left: 0, top: 0, right: width, bottom: height }}
              pos={y(options.target)}
              label={options.targetLabel || `Ziel ${fmtValueCompact(options.target, options)}`}
            />
          )}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--dash-axis)" />
          )}
          <circle
            cx={hover !== null ? points[hover][0] : last[0]}
            cy={hover !== null ? points[hover][1] : last[1]}
            r={hover !== null ? 4.5 : 3.5}
            fill={stroke}
            stroke="var(--card)"
            strokeWidth={2}
          />
        </svg>
      )}
      {hover !== null && (
        <ChartTooltip
          x={x(hover)}
          y={height / 2}
          width={width}
          title={names.long[hover]}
          entries={[
            {
              label: shape.metrics[0]?.label ?? "",
              value: fmtValue(values[hover], options),
              color: stroke,
            },
            ...(compare && ghost[hover] !== null && ghost[hover] !== undefined
              ? [
                  {
                    label: compare.short,
                    value: fmtValue(ghost[hover] as number, options),
                    color: COMPARE_COLOR,
                    line: true,
                    muted: true,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
