import { useId } from "react";
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
  type DatasetShape,
  PALETTE,
  type Widget,
  type WidgetOptions,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { ChartKindPicker } from "./chart-kind-picker";
import { ChartMetricPicker } from "./chart-metric-picker";

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
  const titleId = useId();
  const options = widgetOptions(widget);
  const setOption = <K extends keyof WidgetOptions>(key: K, value: WidgetOptions[K]) =>
    onChange({ options: { ...widget.options, [key]: value } });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Wie soll dein Chart aussehen?</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Wähle nach dem, was du zeigen möchtest. Jede Vorschau hilft dir, die passende Darstellung
          zu finden. Wenn Daten fehlen, siehst du direkt, was noch benötigt wird.
        </p>
      </div>
      <label htmlFor={titleId} className="block max-w-md space-y-1.5 text-xs font-medium">
        <span>Titel deines Charts</span>
        <Input
          id={titleId}
          aria-label="Chart-Titel"
          value={widget.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="z. B. Umsatz pro Monat"
          className="h-9 text-sm"
        />
      </label>
      <ChartKindPicker
        value={widget.chart}
        shape={shape}
        onChange={(chart) => onChange({ chart, options: { ...widget.options, metricKeys: null } })}
      />
      <ChartMetricPicker widget={widget} shape={shape} onChange={onChange} />
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
                    <SelectTrigger aria-label="Linienform" size="sm" className="h-7 w-28 text-xs">
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
                    <SelectTrigger
                      aria-label="Sortierung im Chart"
                      size="sm"
                      className="h-7 w-32 text-xs"
                    >
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
