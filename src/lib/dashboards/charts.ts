import type { ChartDef, ChartKind, WidgetOptions } from "./model";

const COMMON: (keyof WidgetOptions)[] = ["showValue", "showDelta", "showPeriod", "colorOffset"];

export const CHARTS: Record<ChartKind, ChartDef> = {
  kpi: {
    label: "Kennzahl",
    hint: "Eine große Zahl mit Trend",
    dim: "optional",
    metrics: [1, 1],
    w: 3,
    h: 4,
    options: [...COMMON, "curve"],
  },
  area: {
    label: "Verlauf",
    hint: "Flächen über eine Achse",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "stacked", "curve", "showGrid"],
  },
  line: {
    label: "Linien",
    hint: "Eine Linie je Kennzahl",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "curve", "showGrid", "labels"],
  },
  column: {
    label: "Säulen",
    hint: "Senkrechte Säulen je Kategorie",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "stacked", "showGrid", "labels", "sortBy"],
  },
  bars: {
    label: "Pipeline",
    hint: "Horizontale Balken mit Anteil",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  funnel: {
    label: "Funnel",
    hint: "Stufen mit Prozentanteil",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  donut: {
    label: "Donut",
    hint: "Anteile als Ring",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  rings: {
    label: "Ringe",
    hint: "Konzentrische Ringe pro Kategorie",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy"],
  },
  radar: {
    label: "Radar",
    hint: "Netzdiagramm pro Kategorie",
    dim: "required",
    metrics: [1, 3],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy"],
  },
  scatter: {
    label: "Blasen",
    hint: "X, Y und Größe je Zeile, Farbe je Kategorie",
    dim: "optional",
    metrics: [2, 3],
    w: 6,
    h: 8,
    options: [...COMMON, "showLegend", "showGrid"],
  },
  sankey: {
    label: "Fluss",
    hint: "Verbindungen von Quelle zu Ziel",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 9,
    options: [...COMMON],
  },
  score: {
    label: "Score",
    hint: "Erreichte Punkte je Kategorie als Ring",
    dim: "required",
    metrics: [2, 2],
    w: 4,
    h: 7,
    options: [...COMMON, "showLegend"],
  },
  gauge: {
    label: "Tacho",
    hint: "Wert gegen Zielwert als Halbkreis",
    dim: "none",
    metrics: [2, 2],
    w: 3,
    h: 5,
    options: [...COMMON],
  },
  treemap: {
    label: "Treemap",
    hint: "Flächen proportional zum Wert",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "labels", "sortBy"],
  },
  heatmap: {
    label: "Heatmap",
    hint: "Zwei Aufteilungen als farbige Matrix",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "labels"],
  },
  table: {
    label: "Tabelle",
    hint: "Die Rohdaten als Tabelle",
    dim: "optional",
    metrics: [0, 6],
    w: 6,
    h: 7,
    options: ["showValue", "showPeriod"],
  },
};

export const OPTION_LABEL: Record<keyof WidgetOptions, string> = {
  horizontal: "Horizontale Balken",
  showValue: "Kopfzahl anzeigen",
  showDelta: "Trend-Badge anzeigen",
  showLegend: "Legende anzeigen",
  showPeriod: "Zeitraum-Auswahl anzeigen",
  metricKeys: "Kennzahlen",
  colorOffset: "Startfarbe",
  stacked: "Gestapelt",
  curve: "Kurvenform",
  showGrid: "Gitterlinien",
  showPercent: "Prozentwerte anzeigen",
  labels: "Werte direkt am Chart",
  sortBy: "Sortierung",
};

export function chartNeeds(kind: ChartKind): string {
  const def = CHARTS[kind];
  const dim =
    def.dim === "two"
      ? "zwei Aufteilungen"
      : def.dim === "required"
        ? "eine Aufteilung"
        : def.dim === "optional"
          ? "optional eine Aufteilung"
          : "keine Aufteilung";
  const m =
    def.metrics[0] === def.metrics[1]
      ? `${def.metrics[0]} Kennzahl${def.metrics[0] === 1 ? "" : "en"}`
      : `${def.metrics[0]} bis ${def.metrics[1]} Kennzahlen`;
  return `${dim}, ${m}`;
}
