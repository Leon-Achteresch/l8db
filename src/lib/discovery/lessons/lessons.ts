import type { FeatureEventValue } from "../events";
import type { FeatureCapability, GuideStep } from "../types";

export type LessonCheck =
  | { feature: string }
  | { event: string; where?: Readonly<Record<string, FeatureEventValue>> };

export interface LessonStep extends GuideStep {
  id: string;
  check: LessonCheck;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  capability?: FeatureCapability;
  steps: readonly LessonStep[];
}

const OPEN_EDITOR: LessonStep = {
  id: "editor",
  anchor: "query.workspace",
  title: "SQL-Editor öffnen",
  safeClick: true,
  check: { feature: "query.workspace" },
};

const OPEN_TABLE: LessonStep = {
  id: "table",
  anchor: "",
  title: "Tabelle customers öffnen",
  body: "In der Seitenleiste auf customers klicken.",
  check: { event: "table.opened" },
};

export const LESSONS: readonly Lesson[] = [
  {
    id: "first-query",
    title: "Erste Abfrage",
    summary: "SQL schreiben und ausführen.",
    steps: [
      OPEN_EDITOR,
      {
        id: "run",
        anchor: "query.run",
        route: "/query",
        title: "Abfrage ausführen",
        body: "SELECT * FROM customers; eintippen und ausführen.",
        check: { event: "query.executed", where: { ok: true } },
      },
    ],
  },
  {
    id: "filter-bar",
    title: "Filterleiste",
    summary: "Zeilen ohne SQL eingrenzen.",
    steps: [
      OPEN_TABLE,
      {
        id: "filter",
        anchor: "table.filter-bar",
        title: "Filter setzen",
        body: "Zum Beispiel city = Berlin.",
        check: { event: "table.filtered" },
      },
    ],
  },
  {
    id: "export",
    title: "Export",
    summary: "Eine Tabelle als CSV oder Excel speichern.",
    steps: [
      OPEN_TABLE,
      {
        id: "export",
        anchor: "table.export",
        title: "Exportieren",
        check: { event: "export.done" },
      },
    ],
  },
  {
    id: "er-diagram",
    title: "ER-Diagramm",
    summary: "Beziehungen zwischen Tabellen sehen.",
    capability: "foreign_keys",
    steps: [
      {
        id: "open",
        anchor: "er-diagram",
        title: "ER-Diagramm öffnen",
        safeClick: true,
        check: { feature: "er-diagram" },
      },
      {
        id: "export",
        anchor: "er-diagram.text-export",
        route: "/er-diagram",
        title: "Als Mermaid exportieren",
        check: { feature: "er-diagram.text-export" },
      },
    ],
  },
  {
    id: "explain",
    title: "Explain",
    summary: "Verstehen, wie die Datenbank eine Abfrage ausführt.",
    capability: "sql",
    steps: [
      OPEN_EDITOR,
      {
        id: "explain",
        anchor: "explain",
        route: "/query",
        title: "Ausführungsplan anzeigen",
        body: "Eine Abfrage mit JOIN schreiben und Explain klicken.",
        check: { feature: "explain" },
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    summary: "Kennzahlen als Diagramm anlegen.",
    steps: [
      {
        id: "open",
        anchor: "dashboard",
        title: "Dashboard öffnen",
        safeClick: true,
        check: { feature: "dashboard" },
      },
      {
        id: "chart",
        anchor: "dashboard.new-chart",
        route: "/dashboard",
        title: "Diagramm hinzufügen",
        check: { feature: "dashboard.new-chart" },
      },
    ],
  },
];

const byId = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

export function lessonById(id: string): Lesson | undefined {
  return byId.get(id);
}
