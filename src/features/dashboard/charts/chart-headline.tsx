import type { Format } from "@number-flow/react";
import { AnimatedNumber } from "@/components/animated-number";
import type { WidgetOptions } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import type { Summary } from "./chart-summary";
import { DeltaBadge } from "./delta-badge";

function figureFormat(value: number, decimals: number | null, percent: boolean): Format {
  const abs = Math.abs(value);
  if (abs >= 1e6) return { notation: "compact", maximumFractionDigits: 2 };
  if (decimals !== null)
    return { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return { maximumFractionDigits: percent ? 1 : abs < 100 ? 2 : 0 };
}

export function ChartHeadline({
  summary,
  options,
  className,
}: {
  summary: Summary;
  options: WidgetOptions;
  className?: string;
}) {
  const unit = summary.percent ? "%" : options.unit;
  const note = [summary.label, options.showDelta ? summary.deltaLabel : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {summary.text ??
          (summary.value === null ? (
            "–"
          ) : (
            <AnimatedNumber
              value={summary.value}
              format={figureFormat(summary.value, options.decimals, summary.percent)}
              suffix={unit ? ` ${unit}` : undefined}
            />
          ))}
      </span>
      {options.showDelta && summary.delta !== null && (
        <DeltaBadge delta={summary.delta} good={summary.good} points={summary.percent} chip />
      )}
      {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
