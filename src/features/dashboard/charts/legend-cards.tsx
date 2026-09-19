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
