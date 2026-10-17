export type FilterBarStyle = "classic" | "omnibar" | "pills";

export const FILTER_BAR_STYLES: readonly {
  value: FilterBarStyle;
  label: string;
  description: string;
}[] = [
  {
    value: "classic",
    label: "Klassisch",
    description: "Aufklappbares Panel mit Bedingungszeilen wie bisher, ohne KI.",
  },
  {
    value: "omnibar",
    label: "Omnibar",
    description: "Eine Eingabezeile: Bedingung tippen und mit ↵ filtern oder die KI fragen.",
  },
  {
    value: "pills",
    label: "Pill-Leiste",
    description: "Jede Bedingung als anklickbare Pille, KI-Vorschläge mit Vorschau.",
  },
];

export function normalizeFilterBarStyle(value: unknown): FilterBarStyle {
  return value === "omnibar" || value === "pills" ? value : "classic";
}
