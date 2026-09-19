import { fmtCompact, fmtNumber, toLabel, toNumber } from "@/lib/dashboards";
import { type ChartProps, color } from "./chart-utils";

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
