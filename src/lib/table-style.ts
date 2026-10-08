import type { UiDensity } from "@/lib/settings";

export type TableStyle = "classic" | "compact" | "semantic" | "profile";

export const TABLE_STYLES: readonly { value: TableStyle; label: string; description: string }[] = [
  {
    value: "classic",
    label: "Klassisch",
    description: "Bisherige Darstellung mit breiten Spalten und Typ-Badge im Kopf.",
  },
  {
    value: "compact",
    label: "Kompakt",
    description: "Spalten so breit wie ihr Inhalt, flache Zeilen, Zahlen rechtsbündig.",
  },
  {
    value: "semantic",
    label: "Semantisch",
    description: "Werte nach Bedeutung: Status-Pills, Häkchen, relative Zeiten, JSON-Schlüssel.",
  },
  {
    value: "profile",
    label: "Spaltenprofil",
    description: "Kompakt mit Verteilung, Wertebereich und NULL-Anteil im Spaltenkopf.",
  },
];

export function normalizeTableStyle(value: unknown): TableStyle {
  return value === "compact" || value === "semantic" || value === "profile" ? value : "classic";
}

const DENSITY_PADDING: Record<UiDensity, number> = { compact: 2, normal: 6, spacious: 10 };
const STYLE_PADDING_REDUCTION: Record<TableStyle, number> = {
  classic: 0,
  compact: 4,
  semantic: 2,
  profile: 4,
};
const CELL_LINE_HEIGHT = 20;

export function tableCellPadding(style: TableStyle, density: UiDensity): number {
  return Math.max(0, DENSITY_PADDING[density] - STYLE_PADDING_REDUCTION[style]);
}

export function tableRowHeight(style: TableStyle, density: UiDensity, uiScale: number): number {
  return ((CELL_LINE_HEIGHT + 2 * tableCellPadding(style, density)) * uiScale) / 100 + 1;
}
