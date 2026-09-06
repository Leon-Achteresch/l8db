import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_CSV_OPTIONS, type CsvOptions } from "@/lib/export";

export interface ExportTemplate {
  id: string;
  name: string;
  options: CsvOptions;
  createdAt: number;
}

interface ExportTemplatesState {
  templates: ExportTemplate[];
  saveTemplate: (name: string, options: CsvOptions) => ExportTemplate;
  deleteTemplate: (id: string) => void;
}

export function sanitizeExportOptions(options: CsvOptions): CsvOptions {
  return {
    delimiter: options.delimiter,
    quote: options.quote,
    header: options.header,
    nullText: options.nullText,
    lineEnding: options.lineEnding,
    bom: options.bom,
  };
}

export const useExportTemplatesStore = create<ExportTemplatesState>()(
  persist(
    (set, get) => ({
      templates: [],

      saveTemplate: (name, options) => {
        const trimmed = name.trim();
        const existing = get().templates.find((t) => t.name === trimmed);
        const template: ExportTemplate = {
          id: existing?.id ?? crypto.randomUUID(),
          name: trimmed,
          options: sanitizeExportOptions(options),
          createdAt: existing?.createdAt ?? Date.now(),
        };
        set((state) => ({
          templates: [
            template,
            ...state.templates.filter((t) => t.id !== template.id),
          ],
        }));
        return template;
      },

      deleteTemplate: (id) =>
        set((state) => ({ templates: state.templates.filter((t) => t.id !== id) })),
    }),
    {
      name: "l8db.export-templates",
      merge: (persisted, current) => {
        const state = persisted as Partial<ExportTemplatesState> | undefined;
        const templates = (state?.templates ?? [])
          .filter((t) => typeof t?.id === "string" && typeof t?.name === "string")
          .map((t) => ({
            ...t,
            options: sanitizeExportOptions({ ...DEFAULT_CSV_OPTIONS, ...t.options }),
          }));
        return { ...current, templates };
      },
    },
  ),
);
