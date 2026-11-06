import type { ResultChangeKind } from "@/lib/result-compare";

export const CHANGE_TONE: Record<
  ResultChangeKind,
  {
    glyph: string;
    label: string;
    text: string;
    fill: string;
    edge: string;
    wash: string;
    dot: string;
  }
> = {
  changed: {
    glyph: "~",
    label: "Geändert",
    text: "text-primary",
    fill: "fill-primary",
    edge: "border-l-primary",
    wash: "bg-primary/[0.06]",
    dot: "bg-primary",
  },
  added: {
    glyph: "+",
    label: "Neu",
    text: "text-emerald-600 dark:text-emerald-400",
    fill: "fill-emerald-500",
    edge: "border-l-emerald-500",
    wash: "bg-emerald-500/[0.07]",
    dot: "bg-emerald-500",
  },
  removed: {
    glyph: "−",
    label: "Entfernt",
    text: "text-red-600 dark:text-red-400",
    fill: "fill-red-500",
    edge: "border-l-red-500",
    wash: "bg-red-500/[0.07]",
    dot: "bg-red-500",
  },
};
