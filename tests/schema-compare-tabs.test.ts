import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { SavedConnection } from "../src/lib/connections";
import type { CatalogObject } from "../src/lib/db";

let delays: Record<string, number> = {};

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "execute_query") return { columns: ["version"], rows: [{ version: "PG 18" }] };
    if (command !== "schema_catalog") return undefined;
    const schema = String(args.schema);
    await Bun.sleep(delays[schema] ?? 0);
    return [table(schema, `nur_${schema}`)];
  },
}));

const table = (schema: string, name: string): CatalogObject => ({
  object_type: "table",
  name,
  parent: null,
  ddl: `CREATE TABLE "${schema}"."${name}" ()`,
  attributes: {},
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { useProvidersStore } = await import("../src/lib/providers");
const { useTableTabs, tabKey } = await import("../src/lib/table-tabs");
const { loadCompareResult } = await import("../src/lib/schema-compare/persistence");
const { runSchemaCompare, schemaCompareStore, useSchemaCompareStore } = await import(
  "../src/lib/schema-compare/store"
);

const PG: SavedConnection = {
  id: "pg",
  name: "PG",
  kind: "postgres",
  connectionString: "postgresql://u:p@127.0.0.1:5432/app",
  sslMode: "disable",
};
const OTHER: SavedConnection = { ...PG, id: "other", name: "Other" };

const side = (schema: string) => ({ connectionId: "pg", database: "app", schema });

async function eventually<T>(read: () => Promise<T> | T, ok: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (ok(value)) return value;
    await Bun.sleep(5);
  }
  throw new Error("Zeitüberschreitung");
}

const schemaCompareTabs = () =>
  useTableTabs
    .getState()
    .tabs.filter((tab) => tab.kind === "tool" && tab.tool === "schema-compare");

beforeAll(() => useProvidersStore.setState({ loaded: true }));
afterAll(() => useProvidersStore.setState({ loaded: false }));

beforeEach(() => {
  delays = {};
  window.localStorage.clear?.();
  useConnectionsStore.setState({ connections: [PG, OTHER], activeId: "pg" });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, recentlyClosed: [] });
});

describe("mehrere Schema-Vergleiche", () => {
  test("jeder Tab hat einen eigenen Vergleich, auch wenn beide gleichzeitig laufen", async () => {
    useTableTabs.getState().openToolTab("schema-compare", "eins");
    useTableTabs.getState().openToolTab("schema-compare", "zwei");
    expect(schemaCompareTabs().map((tab) => tab.kind === "tool" && tab.id)).toEqual([
      "eins",
      "zwei",
    ]);
    const first = schemaCompareStore("eins");
    const second = schemaCompareStore("zwei");
    expect(first).not.toBe(second);
    first.setState({ source: side("a"), target: side("b"), types: ["table"] });
    second.setState({ source: side("c"), target: side("d"), types: ["table"] });
    delays = { a: 30, b: 30 };
    await Promise.all([runSchemaCompare(undefined, first), runSchemaCompare(undefined, second)]);
    expect(first.getState().error).toBeNull();
    expect(second.getState().error).toBeNull();
    expect(first.getState().result?.items.map((item) => item.name)).toEqual(["nur_a", "nur_b"]);
    expect(second.getState().result?.items.map((item) => item.name)).toEqual(["nur_c", "nur_d"]);
    expect(useSchemaCompareStore.getState().result?.sourceSchema).not.toBe("a");
  });

  test("Einstellungen, Auswahl und Ergebnis überstehen einen Neustart", async () => {
    useTableTabs.getState().openToolTab("schema-compare", "neustart");
    const store = schemaCompareStore("neustart");
    store.setState({ source: side("a"), target: side("b"), types: ["table"] });
    await runSchemaCompare(undefined, store);
    store.setState({ selection: { "table||nur_b": true }, activeKey: "table||nur_b" });
    const saved = await eventually(
      () => loadCompareResult("l8db.schema-compare:neustart"),
      (value) => value !== null,
    );
    expect(saved?.items.map((item) => item.name)).toEqual(["nur_a", "nur_b"]);
    const persisted = JSON.parse(
      window.localStorage.getItem("l8db.schema-compare:neustart") ?? "",
    ).state;
    expect(persisted.source).toEqual(side("a"));
    expect(persisted.selection).toEqual({ "table||nur_b": true });
    expect(persisted.result).toBeUndefined();

    const restarted = await import("../src/lib/schema-compare/store.ts?neustart");
    const again = restarted.schemaCompareStore("neustart");
    expect(again).not.toBe(store);
    expect(again.getState().source).toEqual(side("a"));
    expect(again.getState().target).toEqual(side("b"));
    expect(again.getState().selection).toEqual({ "table||nur_b": true });
    expect(again.getState().activeKey).toBe("table||nur_b");
    const result = await eventually(
      () => again.getState().result,
      (value) => value !== null,
    );
    expect(result?.items.map((item) => item.name)).toEqual(["nur_a", "nur_b"]);
  });

  test("Verbindungswechsel nimmt Schema-Vergleiche mit", () => {
    useTableTabs.getState().openTab({ schema: "public", table: "kunden" });
    useTableTabs.getState().openToolTab("schema-compare", "mit");
    useConnectionsStore.getState().setActiveId("other");
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual(["tool:schema-compare:mit"]);
    expect(useTableTabs.getState().tabsByConnection.pg.map(tabKey)).toEqual([
      "table:public.kunden",
    ]);
    useConnectionsStore.getState().setActiveId("pg");
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([
      "table:public.kunden",
      "tool:schema-compare:mit",
    ]);
    expect(useTableTabs.getState().tabsByConnection.other).toEqual([]);
  });

  test("alter Einzel-Tab wird mit seinem gespeicherten Vergleich übernommen", async () => {
    (useTableTabs.persist.getOptions().storage as unknown as { flush: () => void }).flush();
    window.localStorage.setItem(
      "l8db.schema-compare",
      JSON.stringify({ state: { source: side("alt"), target: side("ziel") }, version: 0 }),
    );
    window.localStorage.setItem(
      "l8db.table-tabs",
      JSON.stringify({
        state: {
          tabsByConnection: { pg: [{ kind: "tool", tool: "schema-compare" }] },
          recentlyClosed: [],
        },
        version: 4,
      }),
    );
    await useTableTabs.persist.rehydrate();
    await useSchemaCompareStore.persist.rehydrate();
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual(["tool:schema-compare:default"]);
    expect(schemaCompareStore("default")).toBe(useSchemaCompareStore);
    expect(useSchemaCompareStore.getState().source).toEqual(side("alt"));
  });

  test("geschlossene Vergleiche bleiben wiederherstellbar und werden erst danach gelöscht", async () => {
    useTableTabs.getState().openToolTab("schema-compare", "weg");
    const store = schemaCompareStore("weg");
    store.setState({ source: side("a"), target: side("b"), types: ["table"] });
    await runSchemaCompare(undefined, store);
    await eventually(
      () => loadCompareResult("l8db.schema-compare:weg"),
      (value) => value !== null,
    );
    useTableTabs.getState().closeTab("tool:schema-compare:weg");
    expect(schemaCompareStore("weg")).not.toBe(store);
    expect(window.localStorage.getItem("l8db.schema-compare:weg")).not.toBeNull();
    const closed = useTableTabs.getState().recentlyClosed[0];
    useTableTabs.getState().reopenClosedTab(closed.recoveryId);
    expect(schemaCompareTabs()).toHaveLength(1);
    expect(schemaCompareStore("weg").getState().source).toEqual(side("a"));
    useTableTabs.getState().closeTab("tool:schema-compare:weg");
    useTableTabs.getState().forgetClosedTab(useTableTabs.getState().recentlyClosed[0].recoveryId);
    expect(window.localStorage.getItem("l8db.schema-compare:weg")).toBeNull();
    await eventually(
      () => loadCompareResult("l8db.schema-compare:weg"),
      (value) => value === null,
    );
  });
});
