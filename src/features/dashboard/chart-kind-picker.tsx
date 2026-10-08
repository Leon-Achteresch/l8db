import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  CHARTS,
  type ChartKind,
  chartNeeds,
  type DatasetShape,
  widgetFits,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { ChartKindPreview } from "./chart-kind-preview";

const GROUPS = [
  {
    id: "overview",
    label: "Überblick",
    hint: "Wichtige Zahlen und Ziele auf einen Blick",
    kinds: ["kpi", "gauge", "score"],
  },
  {
    id: "trend",
    label: "Verlauf",
    hint: "Entwicklungen und Veränderungen erkennen",
    kinds: ["line", "area"],
  },
  {
    id: "comparison",
    label: "Vergleich",
    hint: "Kategorien und Größen vergleichen",
    kinds: ["column", "bars", "radar"],
  },
  {
    id: "share",
    label: "Anteile",
    hint: "Verteilung und Größenverhältnisse zeigen",
    kinds: ["donut", "treemap", "rings", "funnel"],
  },
  {
    id: "relationship",
    label: "Zusammenhänge",
    hint: "Muster, Beziehungen und Datenflüsse entdecken",
    kinds: ["scatter", "heatmap", "sankey"],
  },
  { id: "data", label: "Daten", hint: "Einzelne Werte im Detail lesen", kinds: ["table"] },
] satisfies { id: string; label: string; hint: string; kinds: ChartKind[] }[];

const LABELS: Partial<Record<ChartKind, string>> = {
  area: "Fläche",
  bars: "Balken",
  funnel: "Trichter",
  gauge: "Zielanzeige",
  scatter: "Streuung & Blasen",
  score: "Zielvergleich",
  sankey: "Datenfluss",
};

const HINTS: Record<ChartKind, string> = {
  kpi: "Eine Kennzahl mit ihrem Trend",
  gauge: "Erreichten Wert mit einem Ziel vergleichen",
  score: "Zielerreichung je Kategorie vergleichen",
  line: "Mehrere Kennzahlen entlang einer Achse",
  area: "Entwicklung und Gesamtvolumen zeigen",
  column: "Werte nebeneinander vergleichen",
  bars: "Kategorien nach ihrer Größe vergleichen",
  radar: "Profile über mehrere Kategorien vergleichen",
  donut: "Anteile eines Ganzen als Ring zeigen",
  treemap: "Größen als unterschiedlich große Flächen",
  rings: "Jede Kategorie als eigenen Ring zeigen",
  funnel: "Werte entlang aufeinanderfolgender Stufen",
  scatter: "Beziehungen zwischen Kennzahlen entdecken",
  heatmap: "Muster zwischen zwei Aufteilungen erkennen",
  sankey: "Mengen zwischen Quellen und Zielen zeigen",
  table: "Alle Werte als Zeilen und Spalten anzeigen",
};

function fitProblem(kind: ChartKind, shape: DatasetShape): string | null {
  const problem = widgetFits(kind, shape);
  if (!problem) return null;
  if (CHARTS[kind].dim === "two" && (!shape.dimension || !shape.dimension2))
    return kind === "heatmap"
      ? "Zwei Aufteilungen für Zeilen und Spalten wählen"
      : "Zwei Aufteilungen für Quelle und Ziel wählen";
  if (CHARTS[kind].dim === "required" && !shape.dimension)
    return "Eine Aufteilung nach Zeit oder Kategorie wählen";
  if (CHARTS[kind].dim === "none" && shape.dimension)
    return "Aufteilung entfernen, um einen Gesamtwert zu zeigen";
  return problem;
}

export function ChartKindPicker({
  value,
  shape,
  onChange,
}: {
  value: ChartKind;
  shape: DatasetShape;
  onChange: (kind: ChartKind) => void;
}) {
  const id = useId();
  const feature = useNewFeatureVisibility<HTMLDivElement>("dashboard.chart-gallery");
  const [group, setGroup] = useState("all");
  const available = Object.keys(CHARTS).filter(
    (kind) => !widgetFits(kind as ChartKind, shape),
  ).length;
  const visibleGroups = GROUPS.filter((item) => group === "all" || item.id === group);

  return (
    <div className="space-y-5">
      <div ref={feature.ref} className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {available} von 16 Darstellungen passen zu deinen Daten
        </p>
        <div className="flex items-center gap-2">
          {feature.isNew && <NewBadge />}
          <span className="text-[10px] text-muted-foreground">Schematische Vorschauen</span>
        </div>
      </div>
      <fieldset aria-label="Darstellungen nach Zweck filtern" className="flex flex-wrap gap-1.5">
        {[{ id: "all", label: "Alle" }, ...GROUPS].map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={group === item.id}
            onClick={() => setGroup(item.id)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              group === item.id
                ? "bg-foreground text-background"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      <div className="space-y-6">
        {visibleGroups.map((item) => (
          <section key={item.id} aria-labelledby={`${id}-${item.id}`}>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 id={`${id}-${item.id}`} className="text-xs font-semibold">
                {item.label}
              </h3>
              <p className="text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {item.kinds.map((kind) => {
                const problem = fitProblem(kind, shape);
                const active = value === kind;
                const descriptionId = `${id}-${kind}-description`;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    aria-disabled={Boolean(problem)}
                    aria-describedby={descriptionId}
                    title={chartNeeds(kind)}
                    onClick={() => {
                      if (!problem) onChange(kind);
                    }}
                    className={cn(
                      "relative flex flex-col rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border bg-card",
                      problem ? "cursor-not-allowed" : "hover:border-primary/50 hover:bg-primary/5",
                    )}
                  >
                    {active && (
                      <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-3" />
                      </span>
                    )}
                    <ChartKindPreview
                      kind={kind}
                      className={cn("mb-2", problem && "text-muted-foreground/50")}
                    />
                    <span className="text-xs font-semibold">
                      {LABELS[kind] ?? CHARTS[kind].label}
                    </span>
                    <span
                      id={descriptionId}
                      className="mt-1 text-[11px] leading-relaxed text-muted-foreground"
                    >
                      {HINTS[kind]}
                      {problem && (
                        <span className="mt-2 block border-t border-border/70 pt-2 text-[10px] leading-relaxed">
                          {problem}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
