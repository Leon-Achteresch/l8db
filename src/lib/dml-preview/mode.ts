export type DmlPreviewMode = "off" | "production" | "always";

export const DML_PREVIEW_MODES: { value: DmlPreviewMode; label: string }[] = [
  { value: "off", label: "Aus" },
  { value: "production", label: "Nur in Produktion" },
  { value: "always", label: "Immer" },
];

export function normalizeDmlPreviewMode(value: unknown): DmlPreviewMode {
  return value === "off" || value === "always" ? value : "production";
}

export function autoPreviewApplies(mode: DmlPreviewMode, production: boolean): boolean {
  return mode === "always" || (mode === "production" && production);
}
