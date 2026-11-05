import { expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    prompt: () => null,
  },
});
let requests = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => {
    requests++;
    return null;
  },
}));
const { pluginFilters } = await import("../src/lib/ui-plugins/filters");
const { useTableViewStateStore: store } = await import("../src/lib/table-view-state");
const table = {
  id: "public.items",
  schema: "public",
  name: "items",
  database: null,
  kind: "table" as const,
  connection: {
    id: "c",
    name: "c",
    kind: "postgres",
    environment: null,
    tags: [],
    readOnly: false,
  },
};
const columns = [{ id: "name", label: "Name", type: "text", primaryKey: false }];

test("Plugin-Filter ergänzen einfache Filter und löschen explizit den gesamten Filter", () => {
  store.setState({ views: { key: { filter: '"id" > 3', page: 8 } } });
  const api = pluginFilters(table, columns, "key");
  api.setFilter({ column: "name", operator: "isNull" });
  expect(store.getState().views.key.filter).toBe('("id" > 3) AND ("name" IS NULL)');
  expect(store.getState().views.key.page).toBe(0);
  api.clearFilter();
  expect(store.getState().views.key.filter).toBe("");
});

test("Ungültige und fremde Spalten, leere Tabellen, SQL und fehlende Capability werden abgelehnt", async () => {
  const api = pluginFilters(table, columns, "key");
  expect(() => api.setFilter({ column: "foreign", operator: "isNull" })).toThrow();
  expect(() => api.setFilter({ column: "name", operator: "eq" })).toThrow();
  expect(() =>
    pluginFilters(table, [], "key").setFilter({ column: "name", operator: "isNull" }),
  ).toThrow();
  const selection = api.pickColumn();
  const { useExtensionPrompts } = await import("../src/lib/extensions/prompts");
  const pending = useExtensionPrompts.getState().pending[0];
  useExtensionPrompts.getState().resolve(pending.promptId, undefined);
  expect(await selection).toBeNull();
  expect(await pluginFilters(table, [], "key").pickColumn()).toBeNull();
  store.getState().patch("key", { filterRaw: true });
  expect(() => api.setFilter({ column: "name", operator: "isNull" })).toThrow();
  expect(() =>
    pluginFilters(
      { ...table, connection: { ...table.connection, kind: "redis" } },
      columns,
      "key",
    ).clearFilter(),
  ).toThrow();
});

test("Filter-Latenz bei 10000 Spalten bleibt begrenzt und erzeugt keine DB-Anfragen", () => {
  const many = Array.from({ length: 10000 }, (_, index) => ({ ...columns[0], id: `c${index}` }));
  const api = pluginFilters(table, many, "perf");
  const times: number[] = [];
  const before = requests;
  for (let index = 0; index < 1000; index++) {
    store.getState().patch("perf", { filter: "", filterRaw: false });
    const start = performance.now();
    api.setFilter({ column: "c9999", operator: "isNull" });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    `Plugin setFilter: 10000 Spalten, 1000 Aufrufe, median=${times[500].toFixed(3)}ms p95=${times[950].toFixed(3)}ms`,
  );
  expect(times[950]).toBeLessThan(20);
  expect(requests).toBe(before);
  expect(Object.keys(store.getState().views).length).toBeLessThanOrEqual(100);
});
