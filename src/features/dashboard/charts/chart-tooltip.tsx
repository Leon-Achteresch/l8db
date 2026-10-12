export type TooltipEntry = {
  label: string;
  value: string;
  color: string;
  line?: boolean;
  muted?: boolean;
};

export function ChartTooltip({
  x,
  y,
  width,
  title,
  entries,
  footer,
}: {
  x: number;
  y: number;
  width: number;
  title?: string;
  entries: TooltipEntry[];
  footer?: string;
}) {
  const flip = x > width / 2;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-36 -translate-y-1/2 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/0.12)]"
      style={flip ? { top: y, right: width - x + 14 } : { top: y, left: x + 14 }}
    >
      {title && <div className="mb-1.5 font-medium">{title}</div>}
      <div className="space-y-1">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-center gap-2 whitespace-nowrap">
            <span
              className={
                entry.line ? "h-0.5 w-2.5 shrink-0 rounded-full" : "size-2 shrink-0 rounded-[2px]"
              }
              style={{ background: entry.color }}
            />
            <span className="text-muted-foreground">{entry.label}</span>
            <span
              className={`ml-auto pl-3 tabular-nums ${entry.muted ? "text-muted-foreground" : "font-medium"}`}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  );
}
