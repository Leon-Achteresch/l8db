import { beforeEach, expect, mock, test } from "bun:test";
import { saveNamedQuery, useSavedQueriesStore } from "../src/lib/saved-queries";
import {
  parseSavedQueryImport,
  resolveSavedQueryImport,
  serializeSavedQueryExport,
} from "../src/lib/saved-queries-transfer";
import {
  captureSavedQueryOrigin,
  matchesSavedQuerySearch,
  sanitizeSavedQueryOrigin,
  savedQueryConnectionNames,
  savedQueryOriginForSave,
  savedQueryOriginInfo,
  savedQueryOriginKey,
  storedSavedQueries,
} from "../src/lib/saved-query-origin";

const origin = { connectionId: "dev-id", connectionName: "Development", database: "app" };
const KEY = "l8db.saved-queries";

beforeEach(() => {
  useSavedQueriesStore.setState({ queries: [] });
});

test("origin is consciously selected and cannot follow a context switch", () => {
  const context = captureSavedQueryOrigin(
    {
      id: "dev-id",
      name: "Development",
      get connectionString() {
        throw Error("credentials read");
      },
    },
    "app",
  );
  expect(context).toEqual(origin);
  expect(savedQueryOriginForSave(context, null)).toBeNull();
  const choice = savedQueryOriginKey(context);
  expect(savedQueryOriginForSave(context, choice)).toEqual(origin);
  expect(savedQueryOriginForSave({ ...origin, database: "other" }, choice)).toBeNull();
  expect(savedQueryOriginForSave({ ...origin, connectionId: "other" }, choice)).toBeNull();
  expect(savedQueryOriginForSave(undefined, choice)).toBeNull();
});

test("actual named save/upsert, rename, clear and persisted rehydration preserve old queries", async () => {
  const general = saveNamedQuery("General", "SELECT 1", null);
  expect(general).not.toHaveProperty("origin");
  const specific = saveNamedQuery("Orders", "SELECT 2", origin);
  useSavedQueriesStore.getState().updateQuery(specific.id, "Orders renamed", specific.sql);
  expect(useSavedQueriesStore.getState().queries[0]?.origin).toEqual(origin);
  const payload = window.localStorage.getItem(KEY);
  expect(payload).toContain("Development");
  useSavedQueriesStore.setState({ queries: [] });
  window.localStorage.setItem(KEY, payload ?? "");
  await useSavedQueriesStore.persist.rehydrate();
  expect(useSavedQueriesStore.getState().queries).toHaveLength(2);
  expect(useSavedQueriesStore.getState().queries[0]?.origin).toEqual(origin);
  const updated = saveNamedQuery("Orders renamed", "SELECT 3", null);
  expect(updated.id).toBe(specific.id);
  expect(updated.sql).toBe("SELECT 3");
  expect(updated).not.toHaveProperty("origin");
  expect(useSavedQueriesStore.getState().queries).toHaveLength(2);
  window.localStorage.setItem(KEY, JSON.stringify({ state: { queries: [general] }, version: 0 }));
  await useSavedQueriesStore.persist.rehydrate();
  expect(useSavedQueriesStore.getState().queries).toEqual([general]);
  expect(storedSavedQueries({})).toBeNull();
  expect(storedSavedQueries([null, { sql: 2 }])).toEqual([]);
});

test("only allowlisted origin fields survive storage/transfer; URLs and credentials are not captured", () => {
  const unsafe = {
    ...origin,
    connectionString: "postgres://user:pw@host/app",
    password: "sensitive",
    token: "secret",
  };
  const saved = useSavedQueriesStore.getState().saveQuery("Query", "SELECT 1", unsafe);
  expect(saved.origin).toEqual(origin);
  const exported = serializeSavedQueryExport([saved]);
  expect(exported).not.toContain("connectionString");
  expect(exported).not.toContain("postgres://");
  expect(exported).not.toContain("sensitive");
  expect(window.localStorage.getItem(KEY)).not.toContain("sensitive");
  for (const value of [
    "postgres://user:pw@host",
    "password=secret",
    "user:pw@host",
    "a\nspoof",
    "a\u202e",
    "x".repeat(257),
  ]) {
    expect(
      sanitizeSavedQueryOrigin({ ...origin, connectionName: value })?.connectionName,
    ).toBeUndefined();
    expect(sanitizeSavedQueryOrigin({ ...origin, database: value })?.database).toBeNull();
  }
  expect(
    sanitizeSavedQueryOrigin({ ...origin, connectionId: "postgres://user:pw@host" }),
  ).toBeUndefined();
});

test("renamed/deleted/imported connections are hints only; general queries never disappear", () => {
  const saved = saveNamedQuery("Orders", "SELECT 2", origin);
  const general = saveNamedQuery("General", "SELECT 1", null);
  const renamed = savedQueryConnectionNames([{ id: "dev-id", name: "Staging" }]);
  expect(savedQueryOriginInfo(origin, renamed).label).toBe(
    "Staging (gespeichert als Development) · app",
  );
  const missing = savedQueryConnectionNames([{ id: "different-id", name: "Development" }]);
  const unknownName = savedQueryConnectionNames([
    { id: "dev-id", name: "postgres://user:pw@host" },
  ]);
  expect(savedQueryOriginInfo(origin, unknownName).label).toContain("lokaler Name unbekannt");
  expect(savedQueryOriginInfo(origin, unknownName).label).not.toContain("postgres://");
  expect(savedQueryOriginInfo(origin, missing).label).toContain("nicht verfügbar");
  expect(savedQueryOriginInfo(undefined, missing).label).toBe("Allgemein");
  expect(savedQueryOriginInfo(origin, missing).title).toContain("Öffnen wechselt keine Verbindung");
  expect(
    [general, saved].filter((query) => matchesSavedQuerySearch(query, "", missing)),
  ).toHaveLength(2);
  expect(matchesSavedQuerySearch(saved, "staging", renamed)).toBe(true);
  expect(matchesSavedQuerySearch(saved, "app", missing)).toBe(true);
});

test("v1 transfer, duplicate copies and old general formats roundtrip without a target binding", () => {
  const saved = saveNamedQuery("Orders", "SELECT 2", origin);
  const general = saveNamedQuery("General", "SELECT 1", null);
  const text = serializeSavedQueryExport([saved, general]);
  const parsed = parseSavedQueryImport(text, []);
  expect(parsed.error).toBeNull();
  const resolved = resolveSavedQueryImport(parsed.candidates, new Set([0, 1]), "skip");
  expect(resolved).toEqual([saved, general]);
  const copies = resolveSavedQueryImport(
    parseSavedQueryImport(text, [saved]).candidates,
    new Set([0]),
    "copy",
    [saved],
  );
  expect(copies[0]?.origin).toEqual(origin);
  expect(copies[0]?.id).not.toBe(saved.id);
  expect(useSavedQueriesStore.getState().importQueries(copies)).toBe(1);
  const old = JSON.parse(text);
  delete old.queries[0].origin;
  expect(parseSavedQueryImport(JSON.stringify(old), []).candidates[0]?.query).not.toHaveProperty(
    "origin",
  );
});

test("saving never calls native transport or changes the active connection", async () => {
  const calls: string[] = [];
  mock.module("@tauri-apps/api/core", () => ({
    invoke: async (command: string) => {
      calls.push(command);
      return null;
    },
  }));
  const { useConnectionsStore } = await import("../src/lib/connections");
  useConnectionsStore.setState({ activeId: "other" });
  const saved = saveNamedQuery("Origin", "SELECT 1", origin);
  const { useTableTabs } = await import("../src/lib/table-tabs");
  useTableTabs.setState({ tabs: [] });
  useTableTabs.getState().openSavedQueryTab({ id: saved.id, title: saved.name, sql: saved.sql });
  const opened = useTableTabs.getState().tabs.find((tab) => tab.id === saved.id);
  expect(opened).toMatchObject({ kind: "query", sql: "SELECT 1" });
  expect(opened).not.toHaveProperty("autoRun", true);
  expect(opened).not.toHaveProperty("origin");
  expect(useConnectionsStore.getState().activeId).toBe("other");
  expect(calls).toEqual([]);
});
