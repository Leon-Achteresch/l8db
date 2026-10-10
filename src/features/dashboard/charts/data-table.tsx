import { useState } from "react";
import {
  combinable,
  combineTotal,
  DIM_KEY,
  DIM2_KEY,
  fmtValue,
  toLabel,
  toNumber,
} from "@/lib/dashboards";
import { accent, type ChartProps, change, dimAttr, dimensionLabels, goodness } from "./chart-utils";
import { DeltaBadge } from "./delta-badge";

const PAGE = 40;

export function DataTable({
  rows,
  shape,
  options,
  compare,
  totals: exact,
  interactive = false,
}: ChartProps) {
  const [limit, setLimit] = useState(PAGE);
  const dims = [
    ...(shape.dimension
      ? [
          {
            key: shape.dimension,
            label: shape.dimension === DIM_KEY ? "Aufteilung" : shape.dimension,
          },
        ]
      : []),
    ...(shape.dimension2
      ? [
          {
            key: shape.dimension2,
            label: shape.dimension2 === DIM2_KEY ? "Zweite Aufteilung" : shape.dimension2,
          },
        ]
      : []),
  ];
  const metrics = shape.metrics;
  const raw = dims.length || metrics.length ? [] : Object.keys(rows[0] ?? {});
  const labels = Object.fromEntries(
    dims.map((d) => [d.key, dimensionLabels(rows.map((r) => toLabel(r[d.key]))).long]),
  );
  const focus = shape.metrics[0]?.key;
  const fill = accent(options);
  const peaks = Object.fromEntries(
    metrics.map((m) => [
      m.key,
      rows.reduce((peak, row) => Math.max(peak, Math.abs(toNumber(row[m.key]))), 1e-9),
    ]),
  );
  const queried = exact && !exact.complete ? exact : null;
  const totals =
    options.totals && metrics.length && (queried || (rows.length > 1 && metrics.some(combinable)))
      ? Object.fromEntries(
          metrics.map((m) => [
            m.key,
            queried
              ? queried.grand && queried.grand[m.key] != null
                ? toNumber(queried.grand[m.key])
                : null
              : combineTotal(
                  m,
                  rows.map((row) => row[m.key]),
                ),
          ]),
        )
      : null;
  const totalLabel = exact
    ? "Gesamt"
    : metrics.every((m) => m.agg === undefined)
      ? "Summe geladener Zeilen"
      : "Gesamt geladener Zeilen";
  const totalHint = exact
    ? "Über alle Zeilen der Abfrage mit Filtern und Zeitraum berechnet"
    : "Aus den geladenen Zeilen berechnet (Zeilenlimit des Datensatzes)";
  const head = "border-b px-2.5 py-1.5 font-medium";
  return (
    <div
      className="h-full overflow-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (limit < rows.length && el.scrollTop + el.clientHeight * 2 > el.scrollHeight)
          setLimit((current) => current + PAGE);
      }}
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-muted-foreground">
            {dims.map((d) => (
              <th key={d.key} className={`${head} text-left`}>
                {d.label}
              </th>
            ))}
            {metrics.map((m) => (
              <th key={m.key} className={`${head} text-right`}>
                {m.label}
              </th>
            ))}
            {raw.map((key) => (
              <th key={key} className={`${head} text-left`}>
                {key}
              </th>
            ))}
            {compare && focus && <th className={`${head} text-right`}>ggü. {compare.short}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, i) => {
            const before = compare?.rows[i]?.[focus ?? ""];
            const delta =
              compare && focus && before !== undefined && before !== null
                ? change(toNumber(row[focus]), toNumber(before))
                : null;
            return (
              <tr
                key={String(i)}
                data-dim={shape.dimension ? dimAttr(row[shape.dimension]) : undefined}
                data-dim2={shape.dimension2 ? dimAttr(row[shape.dimension2]) : undefined}
                tabIndex={interactive && shape.dimension ? 0 : undefined}
                className="border-b border-border/50 last:border-0"
              >
                {dims.map((d) => (
                  <td key={d.key} className="max-w-48 truncate px-2.5 py-1.5">
                    {labels[d.key]?.[i] ?? toLabel(row[d.key])}
                  </td>
                ))}
                {metrics.map((m) => (
                  <td
                    key={m.key}
                    className="px-2.5 py-1.5 text-right tabular-nums"
                    style={
                      options.dataBars && row[m.key] !== null && row[m.key] !== undefined
                        ? {
                            background: `linear-gradient(to left, color-mix(in oklab, ${fill} 28%, transparent) ${Math.round((Math.abs(toNumber(row[m.key])) / peaks[m.key]) * 100)}%, transparent 0)`,
                          }
                        : undefined
                    }
                  >
                    {row[m.key] === null || row[m.key] === undefined
                      ? "–"
                      : fmtValue(toNumber(row[m.key]), options)}
                  </td>
                ))}
                {raw.map((key) => (
                  <td key={key} className="max-w-48 truncate px-2.5 py-1.5 tabular-nums">
                    {toLabel(row[key])}
                  </td>
                ))}
                {compare && focus && (
                  <td className="px-2.5 py-1.5 text-right">
                    {delta !== null && (
                      <DeltaBadge delta={delta} good={goodness(delta, options.invertDelta)} />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {totals && (
          <tfoot className="sticky bottom-0 bg-card font-medium">
            <tr className="border-t">
              {dims.map((d, i) => (
                <td key={d.key} className="px-2.5 py-1.5" title={i === 0 ? totalHint : undefined}>
                  {i === 0 ? totalLabel : ""}
                </td>
              ))}
              {metrics.map((m) => (
                <td key={m.key} className="px-2.5 py-1.5 text-right tabular-nums">
                  {queried?.pending
                    ? "…"
                    : totals[m.key] === null
                      ? "–"
                      : fmtValue(totals[m.key] ?? 0, options)}
                </td>
              ))}
              {compare && focus && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
