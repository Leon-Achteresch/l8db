import { expect, mock, test } from "bun:test";
import type { SortingState } from "@tanstack/react-table";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  Channel: class {
    onmessage = () => {};
  },
  invoke: async () => [],
}));

const settings = await import("@/lib/settings");
mock.module("@/lib/settings", () => ({
  ...settings,
  useSettingsStore: Object.assign(
    (selector: (state: ReturnType<typeof settings.useSettingsStore.getState>) => unknown) =>
      selector(settings.useSettingsStore.getState()),
    settings.useSettingsStore,
  ),
}));

const { FilterSortControl } = await import("@/features/table/filter-bar/filter-sort-control");
const { FilterOmnibar } = await import("@/features/table/filter-bar/filter-omnibar");
const { FilterPillBar } = await import("@/features/table/filter-bar/filter-pill-bar");
const { sameSorting, sortingLabel } = await import("@/features/table/table-view/sortable-columns");
const { FALLBACK_PROVIDERS, useProvidersStore } = await import("@/lib/providers");
const { useConnectionsStore } = await import("@/lib/connections");
const { DEFAULT_SETTINGS, useSettingsStore } = settings;
const { SETTINGS_CATALOG } = await import("@/lib/settings-catalog");
const { NEW_FEATURES } = await import("@/lib/new-features");
const { savedViewPatch } = await import("@/lib/views");

useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: true });
useConnectionsStore.setState({
  activeId: "sort",
  connections: [
    {
      id: "sort",
      name: "sort",
      kind: "postgres",
      connectionString: "postgresql://localhost/sort",
      sslMode: "disable",
    },
  ],
});

const COLUMNS = ["id", "status", "created_at"];
const asc: SortingState = [{ id: "status", desc: false }];
const desc: SortingState = [{ id: "status", desc: true }];
const control = (
  sorting: SortingState | null,
  patch: { sortableColumns?: string[]; columns?: string[]; showLabel?: boolean } = {},
) =>
  renderToStaticMarkup(
    createElement(FilterSortControl, {
      sort: sorting
        ? { sorting, sortableColumns: patch.sortableColumns, onChange: () => {} }
        : undefined,
      columns: patch.columns ?? COLUMNS,
      showLabel: patch.showLabel,
    }),
  );
const enable = (value: boolean) => useSettingsStore.getState().setFilterBarSorting(value);

test("die Einstellung ist optional, standardmäßig aus und im Katalog auffindbar", () => {
  expect(DEFAULT_SETTINGS.filterBarSorting).toBe(false);
  expect(useSettingsStore.getState().filterBarSorting).toBe(false);
  enable(true);
  expect(useSettingsStore.getState().filterBarSorting).toBe(true);
  useSettingsStore.getState().resetAppearance();
  expect(useSettingsStore.getState().filterBarSorting).toBe(false);
  const entry = SETTINGS_CATALOG.find((item) => item.id === "filter-bar-sorting");
  expect(entry?.key).toBe("filterBarSorting");
  expect(entry?.tabId).toBe("appearance");
  expect(NEW_FEATURES["settings.appearance.filter-sorting"]).toBeDefined();
});

test("ohne Einstellung oder ohne Sortierquelle erscheint nichts", () => {
  enable(false);
  expect(control(asc)).toBe("");
  expect(control([])).toBe("");
  enable(true);
  expect(control(null)).toBe("");
  expect(control([], { sortableColumns: [] })).toBe("");
  expect(control([], { columns: [] })).toBe("");
  expect(control([], { sortableColumns: ["unknown"] })).toBe("");
});

test("ohne Sortierung bietet die Leiste einen Knopf, mit Sortierung einen Baustein", () => {
  enable(true);
  const empty = control([]);
  expect(empty).toContain('aria-label="Sortierung hinzufügen"');
  expect(empty).toContain("Sortierung</button>");
  expect(empty).not.toContain('data-filter-token="sort"');
  expect(control([], { showLabel: false })).not.toContain("Sortierung</button>");

  const up = control(asc);
  expect(up).toContain('data-filter-token="sort"');
  expect(up).toContain('aria-label="Aufsteigend nach status – absteigend sortieren"');
  expect(up).toContain('aria-label="Sortierung ändern: status"');
  expect(up).toContain('aria-label="Sortierung entfernen: status"');
  expect(up).not.toContain("Sortierung hinzufügen");
  expect(control(desc)).toContain('aria-label="Absteigend nach status – aufsteigend sortieren"');
});

test("eine aktive Sortierung bleibt sichtbar, auch wenn Spalten noch laden", () => {
  enable(true);
  expect(control(asc, { columns: [] })).toContain('aria-label="Sortierung entfernen: status"');
  expect(control(asc, { sortableColumns: [] })).toContain('data-filter-token="sort"');
});

test("Spaltennamen werden nicht als HTML ausgegeben", () => {
  enable(true);
  const markup = control([{ id: '<img src=x onerror="1">', desc: false }]);
  expect(markup).not.toContain("<img");
  expect(markup).toContain("&lt;img");
});

test("Omnibar und Pill-Leiste zeigen die Sortierung nur mit der Einstellung", () => {
  const props = (stateKey: string) => ({
    stateKey,
    columns: COLUMNS,
    activeFilter: "",
    onApply: () => {},
    sort: { sorting: desc, onChange: () => {} },
  });
  for (const [name, bar] of [
    ["omnibar", FilterOmnibar],
    ["pills", FilterPillBar],
  ] as const) {
    enable(false);
    const off = renderToStaticMarkup(createElement(bar, props(`${name}-off`)));
    expect(off).not.toContain('data-filter-token="sort"');
    expect(off).not.toContain("Sortierung hinzufügen");
    enable(true);
    const on = renderToStaticMarkup(createElement(bar, props(`${name}-on`)));
    expect(on).toContain('data-filter-token="sort"');
    expect(on).toContain('aria-label="Sortierung entfernen: status"');
    const none = renderToStaticMarkup(
      createElement(bar, { ...props(`${name}-none`), sort: undefined }),
    );
    expect(none).not.toContain("Sortierung hinzufügen");
  }
});

test("Sortierungen werden über Spalte und Richtung verglichen und beschriftet", () => {
  expect(sortingLabel(undefined)).toBe("");
  expect(sortingLabel([])).toBe("");
  expect(sortingLabel(asc)).toBe("↑ status");
  expect(sortingLabel(desc)).toBe("↓ status");
  expect(sameSorting(asc, [{ id: "status", desc: false }])).toBe(true);
  expect(sameSorting(asc, desc)).toBe(false);
  expect(sameSorting(asc, [{ id: "id", desc: false }])).toBe(false);
  expect(sameSorting(undefined, [])).toBe(true);
  expect(sameSorting(asc, undefined)).toBe(false);
  expect(sameSorting(asc, [...asc, { id: "id", desc: true }])).toBe(true);
});

test("eine gespeicherte Ansicht setzt Filter und Sortierung gemeinsam", () => {
  const view = { id: "v", name: "Fehler", color: "#000", filter: "status = 'error'" };
  expect(savedViewPatch(undefined, "", false)).toBeUndefined();
  expect(savedViewPatch(view, view.filter, false)).toBeUndefined();

  const sorted = savedViewPatch(
    { ...view, state: { sorting: desc, page: 7, filter: "old", filterRaw: true } },
    view.filter,
    undefined,
  );
  expect(sorted).toEqual({ sorting: desc, page: 0, filter: view.filter, filterRaw: false });

  const unsorted = savedViewPatch({ ...view, state: { filterMode: "sql" } }, view.filter, true);
  expect(unsorted).toEqual({
    filterMode: "sql",
    sorting: [],
    page: 0,
    filter: view.filter,
    filterRaw: true,
  });
});
