import { formatBytes } from "@/features/monitor/monitor-view/format";
import type { LabTable } from "./atlas-lab-data";

const BANDS = [
  { label: "Über 1 MB", min: 1_048_576 },
  { label: "256 KB bis 1 MB", min: 262_144 },
  { label: "Unter 256 KB", min: 0 },
];

export function AtlasLabSpectrum({ tables }: { tables: LabTable[] }) {
  const largest = tables[0]?.weight ?? 1;
  let from = 0;
  const bands = BANDS.map((band) => {
    const start = from;
    while (from < tables.length && tables[from].bytes >= band.min) from++;
    return { ...band, tables: tables.slice(start, from) };
  }).filter((band) => band.tables.length);

  return (
    <div className="h-full w-full space-y-5 overflow-auto pr-1">
      {bands.map((band) => (
        <section key={band.label} className="space-y-2">
          <h4 className="sticky top-0 z-10 flex items-baseline gap-2 bg-gradient-to-b from-background/90 to-transparent pb-1 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-sm">
            {band.label}
            <span className="tabular-nums">{band.tables.length}</span>
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-3 gap-y-1">
            {band.tables.map((table) => (
              <button
                key={table.name}
                type="button"
                className="group relative flex h-7 items-center justify-between gap-2 overflow-hidden rounded-md px-2 text-left hover:bg-card/60"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 left-0 rounded-r-md bg-gradient-to-r from-[var(--chart-1)] via-[var(--chart-2)] to-[var(--chart-3)] opacity-25 transition-opacity group-hover:opacity-60"
                  style={{ width: `${(table.weight / largest) * 100}%` }}
                />
                <span className="relative truncate font-mono text-[11.5px]">{table.name}</span>
                <span className="relative shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                  {formatBytes(table.bytes)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
