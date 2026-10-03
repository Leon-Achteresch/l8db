import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type HomeWidgetKind =
  | "metrics"
  | "tables"
  | "recent"
  | "storage"
  | "er-diagram"
  | "performance"
  | "chart"
  | "query"
  | "note";

export interface HomeWidget {
  id: string;
  kind: HomeWidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  dashboardId?: string;
  chartId?: string;
  title?: string;
  sql?: string;
  text?: string;
}

export const HOME_GRID_COLS = 12;
export const HOME_ROW_HEIGHT = 44;
export const HOME_GRID_GAP = 16;
export const HOME_STACK_WIDTH = 720;

export const HOME_WIDGETS: Record<
  HomeWidgetKind,
  { label: string; w: number; h: number; minW: number; minH: number; single: boolean }
> = {
  metrics: { label: "Kennzahlen", w: 12, h: 2, minW: 3, minH: 2, single: true },
  tables: { label: "Tabellen", w: 7, h: 7, minW: 3, minH: 4, single: true },
  recent: { label: "Letzte Abfragen", w: 7, h: 5, minW: 3, minH: 3, single: true },
  storage: { label: "Speicher & Schemas", w: 5, h: 9, minW: 3, minH: 4, single: true },
  "er-diagram": { label: "ER-Diagramm", w: 5, h: 4, minW: 3, minH: 4, single: true },
  performance: { label: "Performance", w: 7, h: 8, minW: 4, minH: 5, single: true },
  chart: { label: "Dashboard-Chart", w: 6, h: 7, minW: 2, minH: 3, single: false },
  query: { label: "Abfrage-Ergebnis", w: 6, h: 7, minW: 3, minH: 3, single: false },
  note: { label: "Notiz", w: 4, h: 4, minW: 2, minH: 2, single: false },
};

export const DEFAULT_HOME_LAYOUT: HomeWidget[] = [
  { id: "metrics", kind: "metrics", x: 0, y: 0, w: 12, h: 2 },
  { id: "tables", kind: "tables", x: 0, y: 2, w: 7, h: 7 },
  { id: "recent", kind: "recent", x: 0, y: 9, w: 7, h: 5 },
  { id: "storage", kind: "storage", x: 7, y: 2, w: 5, h: 9 },
  { id: "er-diagram", kind: "er-diagram", x: 7, y: 11, w: 5, h: 4 },
];

function freeSpot(widgets: HomeWidget[], w: number, h: number): { x: number; y: number } {
  const bottom = Math.max(0, ...widgets.map((widget) => widget.y + widget.h));
  for (let y = 0; y < bottom; y++)
    for (let x = 0; x + w <= HOME_GRID_COLS; x++)
      if (
        widgets.every(
          (other) =>
            x >= other.x + other.w ||
            x + w <= other.x ||
            y >= other.y + other.h ||
            y + h <= other.y,
        )
      )
        return { x, y };
  return { x: 0, y: bottom };
}

export function placeHomeWidget(
  widgets: HomeWidget[],
  kind: HomeWidgetKind,
  extra: Partial<HomeWidget> = {},
): HomeWidget {
  const w = Math.min(extra.w ?? HOME_WIDGETS[kind].w, HOME_GRID_COLS);
  const h = extra.h ?? HOME_WIDGETS[kind].h;
  return { id: crypto.randomUUID(), kind, ...extra, w, h, ...freeSpot(widgets, w, h) };
}

export function sanitizeHomeLayouts(value: unknown): Record<string, HomeWidget[]> {
  if (typeof value !== "object" || value === null) return {};
  const layouts: Record<string, HomeWidget[]> = {};
  for (const [connectionId, widgets] of Object.entries(value)) {
    if (!Array.isArray(widgets)) continue;
    layouts[connectionId] = widgets.filter(
      (widget): widget is HomeWidget =>
        typeof widget === "object" &&
        widget !== null &&
        typeof widget.id === "string" &&
        Object.hasOwn(HOME_WIDGETS, widget.kind) &&
        [widget.x, widget.y, widget.w, widget.h].every(Number.isFinite),
    );
  }
  return layouts;
}

interface HomeLayoutState {
  layouts: Record<string, HomeWidget[]>;
  setLayout: (connectionId: string, update: (widgets: HomeWidget[]) => HomeWidget[]) => void;
  resetLayout: (connectionId: string) => void;
}

const STORAGE_KEY = "l8db.home-layout";

export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist(
    (set) => ({
      layouts: {},
      setLayout: (connectionId, update) =>
        set((state) => ({
          layouts: {
            ...state.layouts,
            [connectionId]: update(state.layouts[connectionId] ?? DEFAULT_HOME_LAYOUT),
          },
        })),
      resetLayout: (connectionId) =>
        set((state) => {
          const layouts = { ...state.layouts };
          delete layouts[connectionId];
          return { layouts };
        }),
    }),
    {
      name: STORAGE_KEY,
      merge: (persisted, current) => ({
        ...current,
        layouts: sanitizeHomeLayouts((persisted as Partial<HomeLayoutState> | undefined)?.layouts),
      }),
    },
  ),
);

syncAcrossWindows(STORAGE_KEY, () => void useHomeLayoutStore.persist.rehydrate());
