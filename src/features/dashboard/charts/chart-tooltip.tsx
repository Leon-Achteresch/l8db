export type TooltipEntry = { label: string; value: string; color: string };

export function ChartTooltip({
  x,
  y,
  width,
  title,
  entries,
}: {
  x: number;
  y: number;
  width: number;
  title?: string;
  entries: TooltipEntry[];
}) {
  const flip = x > width / 2;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-28 -translate-y-1/2 rounded-xl border bg-card px-2.5 py-1.5 text-xs text-card-foreground shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
      style={flip ? { top: y, right: width - x + 12 } : { top: y, left: x + 12 }}
    >
      {title && <div className="mb-1 font-medium">{title}</div>}
      {entries.map((entry) => (
        <div key={entry.label} className="flex items-center gap-2 whitespace-nowrap">
          <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.label}</span>
          <span className="ml-auto pl-2 tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}
