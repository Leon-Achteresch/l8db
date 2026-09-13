import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CsvColumnMapping, CsvEmptyFieldMode } from "@/lib/csv-import";
export interface CsvMappingPreset {
  id: string;
  name: string;
  scope: string;
  headers: string[];
  mappings: CsvColumnMapping[];
  delimiter: string;
  quote: string;
  hasHeader: boolean;
  emptyField: CsvEmptyFieldMode;
}
export const useCsvMappingPresets = create<{ presets: CsvMappingPreset[] }>()(
  persist(() => ({ presets: [] as CsvMappingPreset[] }), { name: "l8db.csv-mapping-presets" }),
);
export function remapPreset(preset: CsvMappingPreset, headers: string[]): CsvColumnMapping[] {
  if (!preset.hasHeader && JSON.stringify(headers) !== JSON.stringify(preset.headers))
    throw new Error("Die Spaltenanzahl stimmt nicht mit der Vorlage überein.");
  if (
    new Set(headers).size !== headers.length ||
    new Set(preset.headers).size !== preset.headers.length
  )
    throw new Error("Vorlagen benötigen eindeutige Spaltennamen.");
  return headers.map((header, csvIndex) => ({
    csvIndex,
    target:
      preset.mappings.find((mapping) => preset.headers[mapping.csvIndex] === header)?.target ??
      null,
  }));
}
