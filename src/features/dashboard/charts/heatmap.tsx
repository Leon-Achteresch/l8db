import { fmtValue, fmtValueCompact, toLabel, toNumber } from "@/lib/dashboards";
import { accent, type ChartProps, dimensionLabels } from "./chart-utils";

export function Heatmap({ rows, shape, options }: ChartProps) {
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
  const base = accent(options);
  const xNames = dimensionLabels(xs);
  const yNames = dimensionLabels(ys);
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th />
            {xs.map((x, i) => (
              <th
                key={x}
                className="truncate px-1 pb-1 text-center font-normal text-muted-foreground"
              >
                {xNames.short[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((y, row) => (
            <tr key={y}>
              <th className="truncate pr-2 text-right font-normal text-muted-foreground">
                {yNames.short[row]}
              </th>
              {xs.map((x) => {
                const v = cells.get(`${y}|${x}`) ?? 0;
                const share = v ? Math.round(12 + (v / max) * 88) : 0;
                return (
                  <td
                    key={x}
                    title={`${yNames.long[row]} × ${xNames.long[xs.indexOf(x)]}: ${fmtValue(v, options)}`}
                    className="h-8 rounded-[4px] text-center tabular-nums"
                    style={{
                      background: share
                        ? `color-mix(in oklab, ${base} ${share}%, var(--dash-track))`
                        : "var(--dash-track)",
                      color: share > 55 ? "white" : undefined,
                    }}
                  >
                    {options.labels && v ? fmtValueCompact(v, { ...options, unit: "" }) : ""}
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
