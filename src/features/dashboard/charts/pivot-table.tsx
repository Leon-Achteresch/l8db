import { additive, fmtValue, toLabel, toNumber } from "@/lib/dashboards";
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

export function PivotTable({ rows, shape, options }: ChartProps) {
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
  const sum = (value: number | undefined) => (summable ? fmtValue(value ?? 0, options) : "–");
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
                title={xNames.long[i]}
                className={`${head} max-w-36 cursor-pointer truncate text-right`}
              >
                {xNames.short[i]}
              </th>
            ))}
            {options.totals && <th className={`${head} text-right text-foreground`}>Summe</th>}
          </tr>
        </thead>
        <tbody>
          {ys.labels.map((y, r) => (
            <tr key={y} className="border-b border-border/50">
              <th
                scope="row"
                data-dim={dimAttr(ys.raw[r])}
                title={yNames.long[r]}
                className="sticky left-0 max-w-44 cursor-pointer truncate bg-card px-2.5 py-1.5 text-left font-normal text-muted-foreground"
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
                    className="cursor-pointer px-2.5 py-1.5 text-right"
                    style={{ background: value === undefined ? undefined : fill(value) }}
                  >
                    {value === undefined ? "–" : fmtValue(value, options)}
                  </td>
                );
              })}
              {options.totals && (
                <td className="px-2.5 py-1.5 text-right font-medium">{sum(rowTotals.get(y))}</td>
              )}
            </tr>
          ))}
        </tbody>
        {options.totals && (
          <tfoot>
            <tr className="font-medium">
              <th className="sticky bottom-0 left-0 bg-card px-2.5 py-1.5 text-left">Summe</th>
              {xs.labels.map((x) => (
                <td key={x} className="sticky bottom-0 bg-card px-2.5 py-1.5 text-right">
                  {sum(colTotals.get(x))}
                </td>
              ))}
              <td className="sticky bottom-0 bg-card px-2.5 py-1.5 text-right">{sum(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
