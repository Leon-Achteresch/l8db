import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  BUCKET_LABEL,
  CHARTS,
  type ChartKind,
  chartFits,
  chartNeeds,
  type Dataset,
  type DatasetShape,
  datasetShape,
  OPTION_LABEL,
  PALETTE,
  PERIOD_LABEL,
  type Period,
  refLabel,
  toLabel,
  useDashboardsStore,
  type Widget,
  type WidgetOptions,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { CHART_ICONS } from "./chart-palette";

const NONE = "__none__";
const EMPTY_DATASETS: Dataset[] = [];

function describe(dataset: Dataset | null, shape: DatasetShape | null) {
  if (!dataset || !shape) return null;
  if (dataset.mode === "expert")
    return {
      dimension: shape.dimension,
      dimension2: shape.dimension2,
      dateColumn: dataset.mapping.dateColumn,
    };
  const s = dataset.simple;
  return {
    dimension: s.dimension
      ? `${refLabel(s.dimension.column, s)}${s.dimension.bucket !== "none" ? ` · ${BUCKET_LABEL[s.dimension.bucket]}` : ""}`
      : null,
    dimension2: s.dimension2 ? refLabel(s.dimension2, s) : null,
    dateColumn: s.dateColumn ? refLabel(s.dateColumn, s) : null,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function WidgetSettings({
  open,
  onOpenChange,
  widget,
  dashboardId,
  rows,
  onChange,
  onRemove,
  onDuplicate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget: Widget;
  dashboardId: string;
  rows: Record<string, unknown>[];
  onChange: (patch: Partial<Widget>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const datasets = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.datasets ?? EMPTY_DATASETS,
  );
  const dataset = datasets.find((d) => d.id === widget.datasetId) ?? null;
  const shape = dataset ? datasetShape(dataset) : null;
  const info = describe(dataset, shape);
  const options = widgetOptions(widget);
  const def = CHARTS[widget.chart];
  const setOption = <K extends keyof WidgetOptions>(key: K, value: WidgetOptions[K]) =>
    onChange({ options: { ...widget.options, [key]: value } });
  const selectedMetrics = options.metricKeys ?? shape?.metrics.map((m) => m.key) ?? [];
  const toggleMetric = (key: string) => {
    if (selectedMetrics.includes(key) && selectedMetrics.length === 1) return;
    const next = selectedMetrics.includes(key)
      ? selectedMetrics.filter((k) => k !== key)
      : [...selectedMetrics, key];
    setOption("metricKeys", next);
  };
  const previewKeys = [
    ...(shape?.dimension ? [shape.dimension] : []),
    ...(shape?.dimension2 ? [shape.dimension2] : []),
    ...(shape?.metrics.map((m) => m.key) ?? []),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Karte einstellen</SheetTitle>
          <SheetDescription>
            Lege fest, welche Daten die Karte nutzt und wie sie dargestellt wird.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <Section title="Allgemein">
            <Input
              className="h-8 text-xs"
              placeholder="Titel (Standard: Name des Datensatzes)"
              value={widget.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <Select
              value={widget.datasetId ?? NONE}
              onValueChange={(id) =>
                onChange({
                  datasetId: id === NONE ? null : id,
                  options: { ...widget.options, metricKeys: null },
                })
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue placeholder="Datensatz" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Datensatz</SelectItem>
                {datasets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {shape?.hasDate && (
              <Select
                value={widget.period}
                onValueChange={(period) => onChange({ period: period as Period })}
              >
                <SelectTrigger size="sm" className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIOD_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Section>

          <Section title="Chart-Typ">
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(CHARTS) as ChartKind[]).map((kind) => {
                const Icon = CHART_ICONS[kind];
                const problem = shape ? chartFits(kind, shape) : "Kein Datensatz";
                const active = kind === widget.chart;
                return (
                  <button
                    key={kind}
                    type="button"
                    title={problem ?? `${CHARTS[kind].hint} (${chartNeeds(kind)})`}
                    onClick={() => onChange({ chart: kind })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] transition-colors",
                      active ? "border-lime-400 bg-lime-400/15 font-medium" : "hover:bg-muted",
                      problem && !active && "opacity-40",
                    )}
                  >
                    <Icon className="size-4" />
                    {CHARTS[kind].label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {def.hint}. Braucht {chartNeeds(widget.chart)}.
            </p>
          </Section>

          <Section title="Verfügbare Daten">
            {!shape ? (
              <p className="text-xs text-muted-foreground">Kein Datensatz zugewiesen.</p>
            ) : (
              <div className="space-y-2 rounded-xl border bg-background/60 p-3 text-xs">
                <Row label="Aufteilung">
                  <span className="truncate font-medium">{info?.dimension ?? "keine"}</span>
                </Row>
                <Row label="Zweite Aufteilung">
                  <span className="truncate font-medium">{info?.dimension2 ?? "keine"}</span>
                </Row>
                <Row label="Zeitspalte">
                  <span className="truncate font-medium">{info?.dateColumn ?? "keine"}</span>
                </Row>
                <div>
                  <p className="mb-1.5">Kennzahlen (Reihenfolge = Klickreihenfolge)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {shape.metrics.map((m) => {
                      const idx = selectedMetrics.indexOf(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          aria-pressed={idx >= 0}
                          onClick={() => toggleMetric(m.key)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
                            idx >= 0 && "border-lime-400 bg-lime-400/15 font-medium",
                          )}
                        >
                          {idx >= 0 ? (
                            <span className="grid size-3.5 place-items-center rounded-full bg-lime-400 text-[9px] text-lime-950">
                              {idx + 1}
                            </span>
                          ) : (
                            <CheckIcon className="size-3 opacity-30" />
                          )}
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {rows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          {previewKeys.map((k) => (
                            <th key={k} className="px-1.5 py-1 font-medium">
                              {k === shape.dimension
                                ? "Aufteilung"
                                : k === shape.dimension2
                                  ? "Zweite Aufteilung"
                                  : (shape.metrics.find((m) => m.key === k)?.label ?? k)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 4).map((row, i) => (
                          <tr key={String(i)} className="border-t border-border/50">
                            {previewKeys.map((k) => (
                              <td key={k} className="max-w-24 truncate px-1.5 py-1 tabular-nums">
                                {toLabel(row[k])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-1.5 py-1 text-[10px] text-muted-foreground">
                      {rows.length} Zeilen geladen
                    </p>
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Darstellung">
            <div className="space-y-2.5 rounded-xl border bg-background/60 p-3">
              {def.options.map((key) => {
                if (key === "metricKeys") return null;
                if (key === "colorOffset")
                  return (
                    <Row key={key} label={OPTION_LABEL[key]}>
                      <div className="flex gap-1">
                        {PALETTE.map((c, i) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Farbe ${i + 1}`}
                            onClick={() => setOption("colorOffset", i)}
                            className={cn(
                              "size-4 rounded-full ring-offset-1 ring-offset-card",
                              options.colorOffset === i && "ring-2 ring-foreground/60",
                            )}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </Row>
                  );
                if (key === "curve")
                  return (
                    <Row key={key} label={OPTION_LABEL[key]}>
                      <Select
                        value={options.curve}
                        onValueChange={(v) => setOption("curve", v as WidgetOptions["curve"])}
                      >
                        <SelectTrigger size="sm" className="h-7 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monotone">Weich</SelectItem>
                          <SelectItem value="linear">Gerade</SelectItem>
                        </SelectContent>
                      </Select>
                    </Row>
                  );
                if (key === "sortBy")
                  return (
                    <Row key={key} label={OPTION_LABEL[key]}>
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
                    </Row>
                  );
                return (
                  <Row key={key} label={OPTION_LABEL[key]}>
                    <Switch
                      checked={Boolean(options[key])}
                      onCheckedChange={(checked) => setOption(key, checked as never)}
                    />
                  </Row>
                );
              })}
            </div>
          </Section>

          <div className="flex justify-between">
            <Button variant="outline" size="xs" onClick={onDuplicate}>
              <CopyIcon /> Duplizieren
            </Button>
            <Button variant="destructive" size="xs" onClick={onRemove}>
              <Trash2Icon /> Löschen
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
