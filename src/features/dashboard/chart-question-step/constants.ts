import type { Agg } from "@/lib/dashboards";

export interface ColumnOpt {
  ref: string;
  label: string;
  type: string;
}

export const AGG_SIMPLE: Record<Agg, string> = {
  count: "Anzahl Zeilen",
  count_distinct: "Anzahl verschiedener Werte",
  sum: "Summe",
  avg: "Durchschnitt",
  min: "Kleinster Wert",
  max: "Größter Wert",
  none: "Jeden Wert einzeln",
};
