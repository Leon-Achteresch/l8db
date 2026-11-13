import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage,
});
mock.module("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

const shared = await import("../src/lib/shared-tabs");
const { SAVED_TABS_BYTES, SAVED_TABS_LIMIT, useSavedTabsStore } = await import(
  "../src/lib/saved-tabs"
);

const sql = Array.from(
  { length: 6_000 },
  (_, index) => `SELECT kunde_${index}, 'Größe ✓' FROM bestellungen WHERE id = ${index};`,
).join("\n");
const queryTab = {
  v: 1 as const,
  connection: { name: "Produktion", kind: "postgres", host: "db.firma.de", port: "5432" },
  database: "shop",
  kind: "query" as const,
  title: "Monatsabschluss",
  sql,
};
const tableTab = {
  ...queryTab,
  kind: "table" as const,
  schema: "public",
  table: "orders",
  entityType: "table" as const,
  view: {
    filterMode: "simple" as const,
    filterCombinator: "AND" as const,
    filterConditions: Array.from({ length: 500 }, (_, index) => ({
      id: `c${index}`,
      column: `col_${index}`,
      operator: "=",
      value: `wert ${index}`,
    })),
    sorting: Array.from({ length: 50 }, (_, index) => ({
      id: `col_${index}`,
      desc: index % 2 === 0,
    })),
  },
};

test("shared tab links stay fast for large scripts and filters", async () => {
  const link = await shared.sharedTabLink(queryTab);
  const tableLink = await shared.sharedTabLink(tableTab);
  const encode = await measureScenario(async () => {
    await shared.sharedTabLink(queryTab);
  });
  const decode = await measureScenario(async () => {
    if (!(await shared.parseSharedTabLink(link))) throw new Error("decode failed");
  });
  const decodeTable = await measureScenario(async () => {
    if (!(await shared.parseSharedTabLink(tableLink))) throw new Error("decode failed");
  });
  const plainText = "x".repeat(500_000);
  const reject = await measureScenario(async () => {
    for (let index = 0; index < 100; index++) await shared.parseSharedTabLink(plainText);
  });
  const simpleTab = { ...tableTab, view: {} };
  const simpleLink = await shared.sharedTabLink(simpleTab);
  const simple = await measureScenario(async () => {
    for (let index = 0; index < 100; index++)
      if (!(await shared.parseSharedTabLink(await shared.sharedTabLink(simpleTab))))
        throw new Error("simple roundtrip failed");
  });
  const hugePaste = `${"x".repeat(shared.MAX_SHARED_TAB_LINK - 20)} kein Link`;
  const detect = await measureScenario(() => {
    for (let index = 0; index < 10; index++)
      if (shared.containsSharedTabLink(hugePaste)) throw new Error("false positive");
  });
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < 1_000; index++) await shared.parseSharedTabLink(simpleLink);
  Bun.gc(true);
  const retainedBytes = process.memoryUsage().heapUsed - heapBefore;
  await reportScenario("shared-tab-link", {
    simpleLinkBytes: simpleLink.length,
    simple,
    detect,
    retainedBytes,
    sqlBytes: sql.length,
    linkBytes: link.length,
    tableLinkBytes: tableLink.length,
    encode,
    decode,
    decodeTable,
    reject,
  });
  expect(link.length).toBeLessThan(sql.length / 5);
  expect(simpleLink.length).toBeLessThan(150);
  expect(simple.p95Ms / 100).toBeLessThan(0.5);
  expect(detect.p95Ms / 10).toBeLessThan(5);
  expect(retainedBytes).toBeLessThan(2_000_000);
  expect(encode.p95Ms).toBeLessThan(40);
  expect(decode.p95Ms).toBeLessThan(40);
  expect(decodeTable.p95Ms).toBeLessThan(10);
  expect(reject.p95Ms / 100).toBeLessThan(0.5);
});

test("connection matching and saved tabs stay bounded", async () => {
  const connections = Array.from({ length: 2_000 }, (_, index) => ({
    id: `c${index}`,
    name: `Verbindung ${index}`,
    kind: "postgres" as const,
    connectionString: `postgresql://user:pw@host-${index}.firma.de:5432/db`,
    sslMode: "prefer" as const,
    ...(index === 1_999 ? { team: { hub: "h", id: "prod", base: {} } } : {}),
  }));
  const resolve = await measureScenario(() => {
    shared.resolveSharedConnection(
      { name: "x", kind: "postgres", host: "host-1500.firma.de", port: "5432" },
      connections,
    );
  });
  expect(
    shared.resolveSharedConnection(
      { name: "x", kind: "postgres", host: "host-1500.firma.de", port: "5432" },
      connections,
    ),
  ).toEqual({ id: "c1500", certain: true });

  const small = { ...queryTab, sql: sql.slice(0, 20_000) };
  const save = await measureScenario(() => {
    for (let index = 0; index < 50; index++)
      useSavedTabsStore.getState().saveTab(small, `T${index}`);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const bytes = localStorage.getItem("l8db.saved-tabs")?.length ?? 0;
  const rehydrate = await measureScenario(async () => {
    await useSavedTabsStore.persist.rehydrate();
  });
  await reportScenario("shared-tab-store", {
    connections: connections.length,
    saved: useSavedTabsStore.getState().saved.length,
    bytes,
    resolve,
    save,
    rehydrate,
  });
  expect(useSavedTabsStore.getState().saved.length).toBeLessThanOrEqual(SAVED_TABS_LIMIT);
  expect(bytes).toBeLessThan(SAVED_TABS_BYTES * 1.05);
  expect(useSavedTabsStore.getState().saveTab(queryTab, "zu groß")).not.toBeNull();
  expect(useSavedTabsStore.getState().saveTab({ ...queryTab, sql: sql.repeat(5) }, "x")).toBeNull();
  expect(resolve.p95Ms).toBeLessThan(15);
  expect(save.p95Ms / 50).toBeLessThan(5);
  expect(rehydrate.p95Ms).toBeLessThan(150);
});
