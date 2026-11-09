import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  appStorage,
  initAppStorage,
  planMigration,
  STORAGE_BACKUP_PREFIX,
  STORAGE_CHANGED_KEY,
  STORAGE_MIGRATED_KEY,
  storageEntries,
} from "../src/lib/app-storage";

function nativeStorage(seed: Record<string, string>) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  };
}

function readDatabase(): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("l8db.storage", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const store = request.result.transaction("entries").objectStore("entries");
      const keys = store.getAllKeys();
      const values = store.getAll();
      values.onsuccess = () => {
        request.result.close();
        resolve(new Map(keys.result.map((key, index) => [String(key), values.result[index]])));
      };
    };
  });
}

const sql = (index: number) =>
  `CREATE OR REPLACE PACKAGE BODY HR.PKG_${index} AS\n${"  PROCEDURE p IS BEGIN NULL; END;\n".repeat(4700)}END;`;
const legacyTabs = JSON.stringify({
  state: {
    tabsByConnection: Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((id) => [
        id,
        Array.from({ length: 5 }, (_, i) => ({ kind: "query", id: `${id}${i}`, sql: sql(i) })),
      ]),
    ),
    recentlyClosed: [],
  },
  version: 4,
});

const listeners = new Map<string, (event: unknown) => void>();
const native = nativeStorage({
  "l8db.table-tabs": legacyTabs,
  "l8db.settings": '{"state":{"uiScale":100},"version":0}',
});
const target = {
  localStorage: native,
  indexedDB,
  navigator: {},
  location: { href: "http://localhost/" },
  addEventListener: (type: string, listener: (event: unknown) => void) =>
    listeners.set(type, listener),
  removeEventListener: (type: string) => listeners.delete(type),
  dispatchEvent: () => true,
} as unknown as Window;

test("legacy localStorage moves into IndexedDB and frees the native quota", async () => {
  expect(await initAppStorage(target)).toBe("indexeddb");
  expect([...native.values.keys()].sort()).toEqual(["l8db.settings", STORAGE_MIGRATED_KEY]);
  expect(target.localStorage).toBe(appStorage);
  expect(appStorage.getItem("l8db.table-tabs")).toBe(legacyTabs);
  const stored = await readDatabase();
  expect(stored.get("l8db.table-tabs")).toBe(legacyTabs);
  expect(stored.get("l8db.settings")).toBe('{"state":{"uiScale":100},"version":0}');
  expect(storageEntries().map(([key]) => key)).toEqual(["l8db.table-tabs", "l8db.settings"]);
});

test("writes in one tick share one transaction and announce once to other windows", async () => {
  for (let index = 0; index < 50; index++) appStorage.setItem(`l8db.burst.${index}`, String(index));
  appStorage.removeItem("l8db.burst.0");
  expect(appStorage.getItem("l8db.burst.0")).toBeNull();
  await Bun.sleep(20);
  const announcement = JSON.parse(native.getItem(STORAGE_CHANGED_KEY) ?? "{}") as {
    keys: string[];
  };
  expect(announcement.keys).toHaveLength(50);
  const stored = await readDatabase();
  expect(stored.has("l8db.burst.0")).toBe(false);
  expect(stored.get("l8db.burst.49")).toBe("49");
  expect(native.values.has("l8db.burst.49")).toBe(false);
  appStorage.setItem("l8db.settings", '{"state":{"uiScale":110},"version":0}');
  expect(native.getItem("l8db.settings")).toBe('{"state":{"uiScale":110},"version":0}');
});

test("after the first migration IndexedDB wins and stale localStorage values become backups", () => {
  const stored = new Map([
    ["l8db.connections", '{"state":{"connections":[1,2,3]}}'],
    ["l8db.table-tabs", "new"],
    ["l8db.query-history", "same"],
  ]);
  const legacy: [string, string][] = [
    ["l8db.connections", '{"state":{"connections":[1]}}'],
    ["l8db.table-tabs", "old"],
    ["l8db.query-history", "same"],
    ["l8db.snippets", "only-legacy"],
    [STORAGE_CHANGED_KEY, "ping"],
    [STORAGE_MIGRATED_KEY, "1"],
  ];
  expect(planMigration(stored, legacy, true)).toEqual({
    puts: [
      ["l8db.connections", '{"state":{"connections":[1]}}'],
      [`${STORAGE_BACKUP_PREFIX}l8db.table-tabs`, "old"],
      ["l8db.snippets", "only-legacy"],
    ],
    removes: ["l8db.table-tabs", "l8db.query-history", "l8db.snippets"],
  });
  expect(planMigration(new Map(), legacy.slice(1, 2), false)).toEqual({
    puts: [["l8db.table-tabs", "old"]],
    removes: ["l8db.table-tabs"],
  });
});

test("5 MB tab state saves without blocking typing and stays bounded in memory", async () => {
  let revision = 0;
  const value = () => legacyTabs.replace("PKG_0", `PKG_${revision++}`);
  const payload = value();
  const timing = await measureScenario(() => {
    appStorage.setItem("l8db.table-tabs", payload.replace("PKG_", `PKG_${revision++}`));
  }, 25);
  await Bun.sleep(50);
  const stored = await readDatabase();
  expect(stored.get("l8db.table-tabs")).toBe(appStorage.getItem("l8db.table-tabs") ?? "");
  expect(storageEntries().length).toBeLessThan(60);
  expect(timing.p95Ms).toBeLessThan(15);
  await reportScenario("app-storage-write", {
    ...timing,
    valueChars: payload.length,
    entries: storageEntries().length,
    databaseRequests: 0,
    limits: { p95Ms: 15 },
  });
});
