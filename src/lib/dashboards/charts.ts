import type { ChartDef, ChartKind, WidgetOptions } from "./model";

const BASE: (keyof WidgetOptions)[] = [
  "showValue",
  "showDelta",
  "showPeriod",
  "colorOffset",
  "unit",
  "decimals",
];
const COMMON: (keyof WidgetOptions)[] = [...BASE, "compare", "headline", "invertDelta"];
const INTERACTIVE: (keyof WidgetOptions)[] = ["crossFilter", "drill"];
const TARGET: (keyof WidgetOptions)[] = ["target", "targetLabel"];

export const CHARTS: Record<ChartKind, ChartDef> = {
  kpi: {
    label: "Kennzahl",
    hint: "Eine große Zahl mit Trend",
    dim: "optional",
    metrics: [1, 1],
    w: 3,
    h: 4,
    options: [...COMMON, "curve", "drill", ...TARGET],
  },
  area: {
    label: "Verlauf",
    hint: "Flächen über eine Achse",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "stacked", "curve", "showGrid", ...INTERACTIVE, ...TARGET],
  },
  line: {
    label: "Linien",
    hint: "Eine Linie je Kennzahl",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "curve", "showGrid", "labels", ...INTERACTIVE, ...TARGET],
  },
  column: {
    label: "Säulen",
    hint: "Senkrechte Säulen je Kategorie",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [
      ...COMMON,
      "showLegend",
      "stacked",
      "showGrid",
      "labels",
      "sortBy",
      "horizontal",
      ...INTERACTIVE,
      ...TARGET,
    ],
  },
  bars: {
    label: "Pipeline",
    hint: "Horizontale Balken mit Anteil",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy", ...INTERACTIVE, ...TARGET],
  },
  funnel: {
    label: "Funnel",
    hint: "Stufen mit Prozentanteil",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "showPercent", "sortBy", ...INTERACTIVE],
  },
  donut: {
    label: "Donut",
    hint: "Anteile als Ring",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy", ...INTERACTIVE],
  },
  rings: {
    label: "Ringe",
    hint: "Konzentrische Ringe pro Kategorie",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy", ...INTERACTIVE],
  },
  radar: {
    label: "Radar",
    hint: "Netzdiagramm pro Kategorie",
    dim: "required",
    metrics: [1, 3],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy", ...INTERACTIVE],
  },
  scatter: {
    label: "Blasen",
    hint: "X, Y und Größe je Zeile, Farbe je Kategorie",
    dim: "optional",
    metrics: [2, 3],
    w: 6,
    h: 8,
    options: [...COMMON, "showLegend", "showGrid", ...INTERACTIVE],
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
    options: [...BASE, "showLegend"],
  },
  gauge: {
    label: "Tacho",
    hint: "Wert gegen Zielwert als Halbkreis",
    dim: "none",
    metrics: [2, 2],
    w: 3,
    h: 5,
    options: [...BASE],
  },
  treemap: {
    label: "Treemap",
    hint: "Flächen proportional zum Wert",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "labels", "sortBy", ...INTERACTIVE],
  },
  heatmap: {
    label: "Heatmap",
    hint: "Zwei Aufteilungen als farbige Matrix",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "labels", ...INTERACTIVE],
  },
  pivot: {
    label: "Pivot",
    hint: "Kreuztabelle mit Summen je Zeile und Spalte",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 8,
    options: [
      "showValue",
      "showPeriod",
      "colorOffset",
      "unit",
      "decimals",
      "totals",
      "dataBars",
      ...INTERACTIVE,
    ],
  },
  table: {
    label: "Tabelle",
    hint: "Die Rohdaten als Tabelle",
    dim: "optional",
    metrics: [0, 6],
    w: 6,
    h: 7,
    options: [
      "showValue",
      "showPeriod",
      "compare",
      "invertDelta",
      "unit",
      "decimals",
      "totals",
      "dataBars",
      ...INTERACTIVE,
    ],
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
  compare: "Vergleich",
  headline: "Kopfzahl",
  invertDelta: "Rückgang ist gut",
  unit: "Einheit",
  decimals: "Nachkommastellen",
  crossFilter: "Klick filtert andere Charts",
  drill: "Details per Klick",
  totals: "Summen anzeigen",
  dataBars: "Datenbalken und Farbskala",
  target: "Zielwert",
  targetLabel: "Beschriftung Ziellinie",
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
