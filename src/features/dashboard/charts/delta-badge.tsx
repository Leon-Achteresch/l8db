import { fmtNumber } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function DeltaBadge({
  delta,
  good,
  points = false,
  chip = false,
  className,
}: {
  delta: number;
  good: boolean | null;
  points?: boolean;
  chip?: boolean;
  className?: string;
}) {
  const tone =
    good === null ? "var(--muted-foreground)" : good ? "var(--dash-up)" : "var(--dash-down)";
  const flat = Math.abs(delta) < 0.05;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-medium tabular-nums",
        chip && "rounded-full px-1.5 py-px",
        className,
      )}
      style={{
        color: tone,
        background: chip ? `color-mix(in oklab, ${tone} 13%, transparent)` : undefined,
      }}
    >
      {!flat && (
        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
          <path d={delta > 0 ? "M5 1.5 9 7.5H1z" : "M5 8.5 1 2.5h8z"} fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">{delta > 0 ? "Plus" : delta < 0 ? "Minus" : ""}</span>
      {fmtNumber(Math.abs(delta), 1)}
      {points ? " Pp." : " %"}
    </span>
  );
}
