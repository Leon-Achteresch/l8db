import { CheckIcon } from "lucide-react";
import { CHARTS, type DatasetShape, type Widget, widgetOptions } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function ChartMetricPicker({
  widget,
  shape,
  onChange,
}: {
  widget: Widget;
  shape: DatasetShape;
  onChange: (patch: Partial<Widget>) => void;
}) {
  const options = widgetOptions(widget);
  const [minimum, maximum] = CHARTS[widget.chart].metrics;
  const available = shape.metrics.map((metric) => metric.key);
  const configured = options.metricKeys?.filter((key) => available.includes(key));
  const selected = configured?.length
    ? configured
    : maximum === 1
      ? available.slice(0, 1)
      : available;
  if (shape.metrics.length < 2) return null;
  return (
    <section aria-label="Kennzahlen im Chart" className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-xs font-semibold">Kennzahlen im Chart</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {maximum === 1
            ? "Diese Darstellung zeigt eine Kennzahl. Wähle, welche du sehen möchtest."
            : `Wähle bis zu ${maximum} Kennzahlen. Die Reihenfolge bestimmt ihre Rolle im Chart.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {shape.metrics.map((metric) => {
          const active = selected.includes(metric.key);
          const disabled =
            maximum > 1 &&
            ((active && selected.length <= Math.max(1, minimum)) ||
              (!active && selected.length >= maximum));
          return (
            <button
              key={metric.key}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() =>
                onChange({
                  options: {
                    ...widget.options,
                    metricKeys:
                      maximum === 1
                        ? [metric.key]
                        : active
                          ? selected.filter((key) => key !== metric.key)
                          : [...selected, metric.key],
                  },
                })
              }
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default",
                active
                  ? "border-primary/40 bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
                disabled && !active && "opacity-50",
              )}
            >
              {active && <CheckIcon className="size-3" />}
              {metric.label}
              {active && maximum > 1 && (
                <span className="text-[10px] text-muted-foreground">
                  {selected.indexOf(metric.key) + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
