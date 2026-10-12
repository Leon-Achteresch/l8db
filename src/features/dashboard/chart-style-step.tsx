import { useId } from "react";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
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
  ACCENT,
  CHARTS,
  type DatasetShape,
  PALETTE,
  type Widget,
  type WidgetOptions,
  widgetOptions,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { ChartKindPicker } from "./chart-kind-picker";
import { ChartMetricPicker } from "./chart-metric-picker";

const OPTION_TEXT: Partial<Record<keyof WidgetOptions, string>> = {
  showValue: "Große Zahl oben zeigen",
  showDelta: "Veränderung zeigen",
  invertDelta: "Rückgang ist gut (z. B. Kosten, Ladezeit)",
  showLegend: "Legende zeigen",
  showGrid: "Hilfslinien zeigen",
  showPercent: "Prozentwerte zeigen",
  labels: "Werte direkt am Chart zeigen",
  stacked: "Reihen stapeln",
  horizontal: "Liegender Chart (Balken nach rechts)",
  crossFilter: "Klick filtert die anderen Charts",
  drill: "Klick zeigt die Detailzeilen",
  totals: "Summen anzeigen",
  dataBars: "Datenbalken und Farbskala",
};

const SELECTS: Partial<
  Record<keyof WidgetOptions, { label: string; width: string; items: [string, string][] }>
> = {
  compare: {
    label: "Vergleichen mit",
    width: "w-32",
    items: [
      ["none", "Nichts"],
      ["previous", "Vorperiode"],
      ["year", "Vorjahr"],
    ],
  },
  headline: {
    label: "Große Zahl zeigt",
    width: "w-32",
    items: [
      ["auto", "Automatisch"],
      ["total", "Summe"],
      ["last", "Letzten Wert"],
      ["average", "Durchschnitt"],
      ["max", "Höchstwert"],
      ["min", "Tiefstwert"],
    ],
  },
  decimals: {
    label: "Nachkommastellen",
    width: "w-32",
    items: [
      ["auto", "Automatisch"],
      ["0", "0"],
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
      ["4", "4"],
    ],
  },
  curve: {
    label: "Linienform",
    width: "w-28",
    items: [
      ["monotone", "Weich"],
      ["linear", "Gerade"],
    ],
  },
  sortBy: {
    label: "Sortierung im Chart",
    width: "w-32",
    items: [
      ["none", "Wie geladen"],
      ["desc", "Größte zuerst"],
      ["asc", "Kleinste zuerst"],
    ],
  },
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
  const subtitleId = useId();
  const compareFeature = useNewFeatureVisibility<HTMLDivElement>("dashboard.studio.compare");
  const interactFeature = useNewFeatureVisibility<HTMLDivElement>("dashboard.studio.interactions");
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
      <label htmlFor={subtitleId} className="block max-w-md space-y-1.5 text-xs font-medium">
        <span>Untertitel</span>
        <Input
          id={subtitleId}
          aria-label="Chart-Untertitel"
          value={widget.subtitle ?? ""}
          onChange={(e) => onChange({ subtitle: e.target.value || undefined })}
          placeholder="Automatisch, z. B. Monatlich · in €"
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
            if (key === "compare" && !shape.hasDate) return null;
            if (key === "target")
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span>Zielwert (Linie)</span>
                  <Input
                    aria-label="Zielwert"
                    type="number"
                    value={options.target ?? ""}
                    onChange={(e) => {
                      const next = e.target.value.trim() === "" ? null : Number(e.target.value);
                      setOption("target", next !== null && Number.isFinite(next) ? next : null);
                    }}
                    placeholder="kein Ziel"
                    className="h-7 w-32 text-xs"
                  />
                </div>
              );
            if (key === "targetLabel")
              return options.target === null ? null : (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span>Beschriftung Ziel</span>
                  <Input
                    aria-label="Beschriftung Ziel"
                    value={options.targetLabel}
                    maxLength={40}
                    onChange={(e) => setOption("targetLabel", e.target.value)}
                    placeholder="z. B. Plan 2026"
                    className="h-7 w-32 text-xs"
                  />
                </div>
              );
            if (key === "unit")
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span>Einheit</span>
                  <Input
                    aria-label="Einheit"
                    value={options.unit}
                    maxLength={8}
                    onChange={(e) => setOption("unit", e.target.value.trimStart())}
                    onBlur={(e) => setOption("unit", e.target.value.trim())}
                    placeholder="€, ms, %"
                    className="h-7 w-32 text-xs"
                  />
                </div>
              );
            const select = SELECTS[key];
            if (select)
              return (
                <div
                  key={key}
                  ref={key === "compare" ? compareFeature.ref : undefined}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    {select.label}
                    {key === "compare" && compareFeature.isNew && <NewBadge />}
                  </span>
                  <Select
                    value={String(options[key] ?? "auto")}
                    onValueChange={(v) =>
                      setOption(
                        key,
                        (key === "decimals" ? (v === "auto" ? null : Number(v)) : v) as never,
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={select.label}
                      size="sm"
                      className={cn("h-7 text-xs", select.width)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {select.items.map(([value, text]) => (
                        <SelectItem key={value} value={value}>
                          {text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            const label = OPTION_TEXT[key];
            if (!label) return null;
            return (
              <div
                key={key}
                ref={key === "crossFilter" ? interactFeature.ref : undefined}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  {label}
                  {key === "crossFilter" && interactFeature.isNew && <NewBadge />}
                </span>
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
              {[ACCENT, ...PALETTE.slice(1)].map((color, index) => (
                <IconButton
                  key={color}
                  aria-label={index === 0 ? "Akzentfarbe der Verbindung" : `Farbe ${index + 1}`}
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
