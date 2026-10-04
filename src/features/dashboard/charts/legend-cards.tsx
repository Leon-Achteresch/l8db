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
        <div key={item.name} className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} />
            <span className="truncate">{item.name}</span>
          </div>
          <div className="mt-1 truncate text-sm font-semibold tabular-nums">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
