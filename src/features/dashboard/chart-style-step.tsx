import { useMemo } from "react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CHARTS,
  type ChartKind,
  chartFits,
  type DatasetShape,
  PALETTE,
  type Widget,
  type WidgetOptions,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { CHART_ICONS } from "./chart-palette";

const OPTION_TEXT: Partial<Record<keyof WidgetOptions, string>> = {
  showValue: "Große Zahl oben zeigen",
  showDelta: "Veränderung zum vorherigen Wert zeigen",
  showLegend: "Legende zeigen",
  showGrid: "Hilfslinien zeigen",
  showPercent: "Prozentwerte zeigen",
  labels: "Werte direkt am Chart zeigen",
  stacked: "Reihen stapeln",
  horizontal: "Liegender Chart (Balken nach rechts)",
};

export function ChartStyleStep({
  widget,
  shape,
  onChange,
}: {
  widget: Widget;
  shape: DatasetShape;
  onChange: (patch: Partial<Widget>) => void;
}) {
  const options = widgetOptions(widget);
  const setOption = <K extends keyof WidgetOptions>(key: K, value: WidgetOptions[K]) =>
    onChange({ options: { ...widget.options, [key]: value } });
  const kinds = useMemo(() => {
    const all = Object.keys(CHARTS) as ChartKind[];
    return [...all].sort((a, b) => {
      const pa = chartFits(a, shape) ? 1 : 0;
      const pb = chartFits(b, shape) ? 1 : 0;
      return pa - pb;
    });
  }, [shape]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Wie soll dein Chart aussehen?</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Wähle eine Darstellung. Ausgegraute Typen passen nicht zu deinen Daten — der Grund steht
          darunter.
        </p>
      </div>
      <label className="block max-w-md space-y-1.5 text-xs font-medium">
        <span>Titel deines Charts</span>
        <Input
          aria-label="Chart-Titel"
          value={widget.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="z. B. Umsatz pro Monat"
          className="h-9 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {kinds.map((kind) => {
          const Icon = CHART_ICONS[kind];
          const problem = chartFits(kind, shape);
          const active = kind === widget.chart;
          return (
            <button
              key={kind}
              type="button"
              disabled={Boolean(problem) && !active}
              aria-pressed={active}
              onClick={() => onChange({ chart: kind })}
              title={problem ?? CHARTS[kind].hint}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                active ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted",
                problem && !active && "opacity-45",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{CHARTS[kind].label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {problem ?? CHARTS[kind].hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <section className="space-y-3 rounded-xl border bg-card/60 p-4">
        <h3 className="text-xs font-semibold">Feinschliff</h3>
        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {CHARTS[widget.chart].options.map((key) => {
            if (key === "metricKeys" || key === "colorOffset" || key === "showPeriod") return null;
            if (key === "curve")
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span>Linienform</span>
                  <Select
                    value={options.curve}
                    onValueChange={(v) => setOption("curve", v as WidgetOptions["curve"])}
                  >
                    <SelectTrigger size="sm" className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monotone">Weich</SelectItem>
                      <SelectItem value="linear">Gerade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            if (key === "sortBy")
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span>Sortierung im Chart</span>
                  <Select
                    value={options.sortBy}
                    onValueChange={(v) => setOption("sortBy", v as WidgetOptions["sortBy"])}
                  >
                    <SelectTrigger size="sm" className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Wie geladen</SelectItem>
                      <SelectItem value="desc">Größte zuerst</SelectItem>
                      <SelectItem value="asc">Kleinste zuerst</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            const label = OPTION_TEXT[key];
            if (!label) return null;
            return (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <span>{label}</span>
                <Switch
                  aria-label={label}
                  checked={Boolean(options[key])}
                  onCheckedChange={(checked) => setOption(key, checked as never)}
                />
              </div>
            );
          })}
        </div>
        {CHARTS[widget.chart].options.includes("colorOffset") && (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
            <span>Farben</span>
            <div className="flex gap-1.5">
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
                  onClick={() => setOption("colorOffset", index)}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
