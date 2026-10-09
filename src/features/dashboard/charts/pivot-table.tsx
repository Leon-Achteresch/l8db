import { additive, DIM_KEY, fmtValue, toLabel, toNumber } from "@/lib/dashboards";
import { accent, type ChartProps, dimAttr, dimensionLabels } from "./chart-utils";

interface Axis {
  labels: string[];
  raw: unknown[];
}

function axisOf(rows: ChartProps["rows"], key: string): Axis {
  const seen = new Map<string, unknown>();
  for (const row of rows) {
    const label = toLabel(row[key]);
    if (!seen.has(label)) seen.set(label, row[key]);
  }
  return { labels: [...seen.keys()], raw: [...seen.values()] };
}

export function PivotTable({
  rows,
  shape,
  options,
  totals: exact,
  interactive = false,
}: ChartProps) {
  const metric = shape.metrics[0]?.key ?? "";
  const rowKey = shape.dimension ?? "";
  const colKey = shape.dimension2 ?? "";
  const ys = axisOf(rows, rowKey);
  const xs = axisOf(rows, colKey);
  const cells = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const y = toLabel(row[rowKey]);
    const x = toLabel(row[colKey]);
    const value = toNumber(row[metric]);
    cells.set(`${y}\u0000${x}`, (cells.get(`${y}\u0000${x}`) ?? 0) + value);
    rowTotals.set(y, (rowTotals.get(y) ?? 0) + value);
    colTotals.set(x, (colTotals.get(x) ?? 0) + value);
    total += value;
  }
  const max = Math.max(1, ...[...cells.values()].map(Math.abs));
  const summable = shape.metrics[0] ? additive(shape.metrics[0]) : false;
  const margin = (list: ChartProps["rows"] | null | undefined) =>
    list ? new Map(list.map((row) => [toLabel(row[DIM_KEY]), row[metric]])) : null;
  const queried = exact && !exact.complete ? exact : null;
  const exactRows = margin(queried?.rows);
  const exactColumns = margin(queried?.columns);
  const show = (value: unknown) =>
    value === null || value === undefined ? "–" : fmtValue(toNumber(value), options);
  const fallback = (value: number | undefined) => (summable ? fmtValue(value ?? 0, options) : "–");
  const marginTotal = (
    exactMap: Map<string, unknown> | null,
    sum: number | undefined,
    key: string,
  ) =>
    queried?.pending ? "…" : exactMap ? show(exactMap.get(key)) : queried ? "–" : fallback(sum);
  const rowTotal = (y: string) => marginTotal(exactRows, rowTotals.get(y), y);
  const columnTotal = (x: string) => marginTotal(exactColumns, colTotals.get(x), x);
  const grandTotal = queried?.pending
    ? "…"
    : queried
      ? show(queried.grand?.[metric])
      : fallback(total);
  const totalLabel = exact ? "Gesamt" : "Summe";
  const totalHint = exact
    ? "Über alle Zeilen der Abfrage mit Filtern und Zeitraum berechnet"
    : "Summe der geladenen Zeilen (Zeilenlimit des Datensatzes)";
  const base = accent(options);
  const xNames = dimensionLabels(xs.labels);
  const yNames = dimensionLabels(ys.labels);
  const head = "sticky top-0 z-10 border-b bg-card px-2.5 py-1.5 font-medium text-muted-foreground";
  const fill = (value: number) =>
    options.dataBars && value
      ? `color-mix(in oklab, ${base} ${Math.round(8 + (Math.abs(value) / max) * 62)}%, transparent)`
      : undefined;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead>
          <tr>
            <th className={`${head} left-0 z-20 text-left`} />
            {xs.labels.map((x, i) => (
              <th
                key={x}
                data-dim2={dimAttr(xs.raw[i])}
                tabIndex={interactive ? 0 : undefined}
                title={xNames.long[i]}
                className={`${head} max-w-36 truncate text-right`}
              >
                {xNames.short[i]}
              </th>
            ))}
            {options.totals && (
              <th title={totalHint} className={`${head} text-right text-foreground`}>
                {totalLabel}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {ys.labels.map((y, r) => (
            <tr key={y} className="border-b border-border/50">
              <th
                scope="row"
                data-dim={dimAttr(ys.raw[r])}
                tabIndex={interactive ? 0 : undefined}
                title={yNames.long[r]}
                className="sticky left-0 max-w-44 truncate bg-card px-2.5 py-1.5 text-left font-normal text-muted-foreground"
              >
                {yNames.short[r]}
              </th>
              {xs.labels.map((x, c) => {
                const value = cells.get(`${y}\u0000${x}`);
                return (
                  <td
                    key={x}
                    data-dim={dimAttr(ys.raw[r])}
                    data-dim2={dimAttr(xs.raw[c])}
                    title={`${yNames.long[r]} × ${xNames.long[c]}`}
                    className="px-2.5 py-1.5 text-right"
                    style={{ background: value === undefined ? undefined : fill(value) }}
                  >
                    {value === undefined ? "–" : fmtValue(value, options)}
                  </td>
                );
              })}
              {options.totals && (
                <td className="px-2.5 py-1.5 text-right font-medium">{rowTotal(y)}</td>
              )}
            </tr>
          ))}
        </tbody>
        {options.totals && (
          <tfoot>
            <tr className="font-medium">
              <th
                className="sticky bottom-0 left-0 bg-card px-2.5 py-1.5 text-left"
                title={totalHint}
              >
                {totalLabel}
              </th>
              {xs.labels.map((x) => (
                <td key={x} className="sticky bottom-0 bg-card px-2.5 py-1.5 text-right">
                  {columnTotal(x)}
                </td>
              ))}
              <td className="sticky bottom-0 bg-card px-2.5 py-1.5 text-right">{grandTotal}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
