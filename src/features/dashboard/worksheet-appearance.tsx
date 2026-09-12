import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CHARTS,
  type ChartKind,
  chartFits,
  type DatasetShape,
  PALETTE,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { CHART_ICONS } from "./chart-palette";

export function WorksheetAppearance({
  widget,
  shape,
  onChange,
  onAdvanced,
}: {
  widget: Widget;
  shape: DatasetShape;
  onChange: (patch: Partial<Widget>) => void;
  onAdvanced: () => void;
}) {
  const options = widgetOptions(widget);
  const [showAll, setShowAll] = useState(false);
  const common: ChartKind[] = ["column", "line", "area", "donut", "kpi", "table"];
  return (
    <aside
      aria-label="Darstellung"
      className="min-w-0 space-y-5 overflow-y-auto border-l bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Darstellung</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Die Vorschau reagiert auf jede Änderung.
        </p>
      </div>
      <label htmlFor={`chart-title-${widget.id}`} className="block space-y-1 text-xs font-medium">
        <span>Chart-Titel</span>
        <Input
          id={`chart-title-${widget.id}`}
          aria-label="Chart-Titel"
          value={widget.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="h-8 text-xs"
          placeholder="z. B. Umsatz pro Monat"
        />
      </label>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Chart-Typ</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(CHARTS) as ChartKind[])
            .filter((kind) => showAll || common.includes(kind) || kind === widget.chart)
            .map((kind) => {
              const Icon = CHART_ICONS[kind];
              const problem = chartFits(kind, shape);
              return (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={kind === widget.chart}
                  onClick={() => onChange({ chart: kind })}
                  title={problem ?? CHARTS[kind].hint}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-2 text-left text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                    kind === widget.chart && "border-primary bg-primary/5 font-semibold",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {CHARTS[kind].label}
                </button>
              );
            })}
        </div>
        <Button size="xs" variant="ghost" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Weniger Chart-Typen" : "Weitere Chart-Typen"}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {CHARTS[widget.chart].hint}
        </p>
      </section>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold">Aussehen</h3>
        {(
          [
            ["showLegend", "Legende zeigen"],
            ["labels", "Werte beschriften"],
            ["showGrid", "Hilfslinien zeigen"],
            ["stacked", "Reihen stapeln"],
            ["showValue", "Gesamtwert im Kopf"],
          ] as const
        )
          .filter(([key]) => CHARTS[widget.chart].options.includes(key))
          .map(([key, label]) => (
            <label
              htmlFor={`chart-option-${widget.id}-${key}`}
              key={key}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span>{label}</span>
              <Switch
                id={`chart-option-${widget.id}-${key}`}
                aria-label={label}
                checked={options[key]}
                onCheckedChange={(checked) =>
                  onChange({ options: { ...widget.options, [key]: checked } })
                }
              />
            </label>
          ))}
        <div className="space-y-2">
          <span className="text-xs">Startfarbe</span>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((color, index) => (
              <IconButton
                key={color}
                aria-label={`Farbe ${index + 1}`}
                aria-pressed={options.colorOffset === index}
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "size-5 rounded-full p-0 ring-offset-2 ring-offset-card",
                  options.colorOffset === index && "ring-2 ring-foreground",
                )}
                style={{ background: color }}
                onClick={() => onChange({ options: { ...widget.options, colorOffset: index } })}
              />
            ))}
          </div>
        </div>
      </section>
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Für Fortgeschrittene
        </summary>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Bei Bedarf die Datenquelle mit SQL oder Beziehungen aufbauen.
        </p>
        <Button size="xs" variant="outline" className="mt-2" onClick={onAdvanced}>
          Erweiterte Datenquelle
        </Button>
      </details>
    </aside>
  );
}
