import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  persistConnectionSnapshots,
  restoreConnectionSnapshot,
  SNAPSHOT_KEY,
  SNAPSHOT_MAX_BYTES,
  saveConnectionSnapshot,
} from "../src/lib/connection-snapshot";
import { useConnectionsStore } from "../src/lib/connections/store";
import type { SavedConnection } from "../src/lib/connections/types";

const TABLES = 20_000;
const COLUMNS = 30_000;
const SAMPLES = 21;

function memoryStorage() {
  const items = new Map<string, string>();
  const counts = { writes: 0 };
  const storage = {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      counts.writes++;
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  } satisfies Storage;
  return { storage, counts };
}

function connection(id: string, extra: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id,
    name: id,
    kind: "postgres",
    connectionString: `postgresql://user@localhost/${id}`,
    ...extra,
  } as SavedConnection;
}

function activate(id: string, extra: Partial<SavedConnection> = {}) {
  useConnectionsStore.setState({
    connections: [connection(id, extra), connection("other")],
    activeId: id,
  });
}

function seed(client: QueryClient, id: string) {
  const tables = Array.from({ length: TABLES }, (_, i) => ({
    schema: `schema_${i % 8}`,
    name: `table_${String(i).padStart(5, "0")}_customer_orders`,
  }));
  const columns = Array.from({ length: COLUMNS }, (_, i) => ({
    schema: `schema_${i % 8}`,
    table: `table_${String(i % TABLES).padStart(5, "0")}`,
    name: `column_${i % 60}`,
    data_type: i % 3 ? "numeric" : "text",
  }));
  client.setQueryData(["databases", id], ["app"]);
  client.setQueryData(
    ["schemas", id, "app"],
    Array.from({ length: 8 }, (_, i) => `schema_${i}`),
  );
  client.setQueryData(["tables", id, "app", "schema_0"], tables);
  client.setQueryData(["all-columns", id, "app"], columns);
  client.setQueryData(["rows", id, "app", "schema_0", "table_00000"], { rows: [{ secret: 1 }] });
  client.setQueryData(["view-definition", id, "app", "schema_0", "v"], "select secret");
  client.setQueryData(["tables", "other", "app", "schema_0"], tables.slice(0, 10));
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[sorted.length >> 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

test("Snapshot der letzten Verbindung: Speichern und Wiederherstellen großer Kataloge", async () => {
  activate("pg");
  const source = new QueryClient();
  seed(source, "pg");
  const { storage } = memoryStorage();
  const saves: number[] = [];
  for (let i = 0; i < SAMPLES + 2; i++) {
    const started = performance.now();
    expect(saveConnectionSnapshot(source, storage)).toBe(4);
    if (i >= 2) saves.push(performance.now() - started);
  }
  const raw = storage.getItem(SNAPSHOT_KEY) ?? "";
  expect(raw.length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  expect(raw).not.toContain("secret");
  expect(raw).not.toContain('"other"');

  const restores: number[] = [];
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < SAMPLES + 2; i++) {
    const target = new QueryClient();
    const started = performance.now();
    expect(restoreConnectionSnapshot(target, storage)).toBe(4);
    if (i >= 2) restores.push(performance.now() - started);
    expect(target.isFetching()).toBe(0);
    const query = target.getQueryCache().find({ queryKey: ["tables", "pg", "app", "schema_0"] });
    expect(query?.state.data).toHaveLength(TABLES);
    expect(query?.isStaleByTime(0)).toBe(true);
    target.clear();
  }
  Bun.gc(true);
  const retained = process.memoryUsage().heapUsed - heapBefore;

  const revalidated = new QueryClient();
  restoreConnectionSnapshot(revalidated, storage);
  let requests = 0;
  const observer = new QueryObserver(revalidated, {
    queryKey: ["tables", "pg", "app", "schema_0"],
    queryFn: async () => {
      requests++;
      return [];
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  expect(observer.getCurrentResult().data).toHaveLength(TABLES);
  await Bun.sleep(0);
  unsubscribe();
  expect(requests).toBe(1);

  const save = stats(saves);
  const restore = stats(restores);
  console.log(
    `connection-snapshot ${TABLES} Tabellen + ${COLUMNS} Spalten, ${(raw.length / 1e6).toFixed(2)} MB: speichern ${save.median.toFixed(2)} / ${save.p95.toFixed(2)} ms, wiederherstellen ${restore.median.toFixed(2)} / ${restore.p95.toFixed(2)} ms (Median / p95), Heap danach ${(retained / 1e6).toFixed(2)} MB`,
  );
  expect(save.p95).toBeLessThan(80);
  expect(restore.p95).toBeLessThan(60);
  expect(retained).toBeLessThan(16 * 1024 * 1024);
});

test("Snapshot bleibt unter dem Byte-Limit und übergeht nur zu große Abfragen", () => {
  activate("pg");
  const source = new QueryClient();
  seed(source, "pg");
  const { storage } = memoryStorage();
  expect(saveConnectionSnapshot(source, storage, 1_200_000)).toBe(3);
  const raw = storage.getItem(SNAPSHOT_KEY) ?? "";
  expect(raw.length).toBeLessThanOrEqual(1_200_000);
  expect(raw).toContain('"tables"');
  expect(raw).not.toContain('"all-columns"');
});

test("Snapshot nur für die aktive, gespeicherte Verbindung", () => {
  const source = new QueryClient();
  seed(source, "pg");
  const { storage } = memoryStorage();
  activate("pg", { temporary: true });
  expect(saveConnectionSnapshot(source, storage)).toBe(0);
  expect(storage.getItem(SNAPSHOT_KEY)).toBeNull();

  activate("pg");
  saveConnectionSnapshot(source, storage);
  useConnectionsStore.setState({ activeId: "other" });
  expect(restoreConnectionSnapshot(new QueryClient(), storage)).toBe(0);
  expect(storage.getItem(SNAPSHOT_KEY)).not.toBeNull();

  useConnectionsStore.setState({ connections: [connection("other")], activeId: "other" });
  expect(restoreConnectionSnapshot(new QueryClient(), storage)).toBe(0);
  expect(storage.getItem(SNAPSHOT_KEY)).toBeNull();

  storage.setItem(SNAPSHOT_KEY, "{kaputt");
  expect(restoreConnectionSnapshot(new QueryClient(), storage)).toBe(0);
  expect(storage.getItem(SNAPSHOT_KEY)).toBeNull();
});

test("Snapshot-Schreiben bündelt Aktualisierungen und bleibt im Leerlauf still", async () => {
  activate("pg");
  const client = new QueryClient();
  const { storage, counts } = memoryStorage();
  const dispose = persistConnectionSnapshots(client, storage, 20);
  for (let i = 0; i < 1000; i++) client.setQueryData(["tables", "pg", "app", `s${i % 10}`], [i]);
  client.setQueryData(["rows", "pg", "app", "s", "t"], [1]);
  await Bun.sleep(60);
  expect(counts.writes).toBe(1);
  await Bun.sleep(60);
  expect(counts.writes).toBe(1);

  client.setQueryData(["rows", "pg", "app", "s", "t"], [2]);
  await Bun.sleep(60);
  expect(counts.writes).toBe(1);

  client.setQueryData(["tables", "pg", "app", "s0"], [-1]);
  dispose();
  await Bun.sleep(60);
  expect(counts.writes).toBe(1);
});
