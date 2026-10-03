import { expect, test } from "bun:test";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_GRID_COLS,
  type HomeWidget,
  placeHomeWidget,
  sanitizeHomeLayouts,
  useHomeLayoutStore,
} from "../src/lib/home-layout";

function overlaps(a: HomeWidget, b: HomeWidget): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("neue Widgets füllen freie Lücken, bevor sie unten angehängt werden", () => {
  const gap: HomeWidget[] = [
    { id: "a", kind: "tables", x: 0, y: 0, w: 7, h: 7 },
    { id: "b", kind: "recent", x: 0, y: 7, w: 12, h: 5 },
  ];
  const note = placeHomeWidget(gap, "note");
  expect([note.x, note.y]).toEqual([7, 0]);

  const layout = [...DEFAULT_HOME_LAYOUT];
  for (const kind of ["performance", "chart", "query", "note", "note"] as const)
    layout.push(placeHomeWidget(layout, kind));
  for (const widget of layout) {
    expect(widget.x + widget.w).toBeLessThanOrEqual(HOME_GRID_COLS);
    for (const other of layout) if (other !== widget) expect(overlaps(widget, other)).toBe(false);
  }
  expect(placeHomeWidget([], "chart", { w: 40 }).w).toBe(HOME_GRID_COLS);
});

test("Layouts gelten pro Verbindung und lassen sich zurücksetzen", () => {
  const { setLayout, resetLayout } = useHomeLayoutStore.getState();
  setLayout("one", (widgets) => widgets.filter((widget) => widget.kind !== "tables"));
  const { layouts } = useHomeLayoutStore.getState();
  expect(layouts.one.some((widget) => widget.kind === "tables")).toBe(false);
  expect(layouts.one).toHaveLength(DEFAULT_HOME_LAYOUT.length - 1);
  expect(layouts.two).toBeUndefined();
  resetLayout("one");
  expect(useHomeLayoutStore.getState().layouts.one).toBeUndefined();
});

test("gespeicherte Layouts verlieren unbekannte oder kaputte Widgets", () => {
  const valid = { id: "a", kind: "note", x: 0, y: 0, w: 4, h: 4, text: "bleibt" };
  expect(
    sanitizeHomeLayouts({
      one: [valid, { ...valid, id: "b", kind: "future" }, { ...valid, id: "c", w: null }, null],
      two: "kaputt",
    }),
  ).toEqual({ one: [valid] });
  expect(sanitizeHomeLayouts(undefined)).toEqual({});
});
