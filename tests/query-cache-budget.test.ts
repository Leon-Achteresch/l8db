import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  enforceQueryCacheBudget,
  INACTIVE_QUERY_MAX_BYTES,
  retainedDataBytes,
} from "../src/lib/query-cache-budget";

const key = (page: number, root = "rows") => [
  root,
  "connection",
  "database",
  "public",
  "items",
  page,
];
const page = (text: string) => ({ columns: ["text"], rows: [{ text }] });

function bounded(maxEntries: number, maxBytes = INACTIVE_QUERY_MAX_BYTES) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  enforceQueryCacheBudget(client.getQueryCache(), { maxEntries, maxBytes });
  return client;
}

describe("inactive database result retention", () => {
  test("keeps recently viewed pages and discards the oldest inactive page", () => {
    const client = bounded(2);
    try {
      client.setQueryData(key(0), page("first"));
      client.setQueryData(key(1), page("second"));
      const observer = new QueryObserver(client, { queryKey: key(0), enabled: false });
      const unsubscribe = observer.subscribe(() => undefined);
      unsubscribe();
      client.setQueryData(key(2), page("third"));
      expect(client.getQueryData(key(0))).toEqual(page("first"));
      expect(client.getQueryData(key(1))).toBeUndefined();
      expect(client.getQueryData(key(2))).toEqual(page("third"));
    } finally {
      client.clear();
    }
  });

  test("enforces the byte budget before the entry limit is reached", () => {
    const value = page("x".repeat(1024));
    const client = bounded(20, retainedDataBytes(value) * 2);
    try {
      for (let index = 0; index < 10; index++) client.setQueryData(key(index), value);
      expect(client.getQueryCache().getAll()).toHaveLength(2);
      expect(client.getQueryData(key(8))).toEqual(value);
      expect(client.getQueryData(key(9))).toEqual(value);
    } finally {
      client.clear();
    }
  });

  test("does not discard visible results or start replacement database reads under pressure", () => {
    const client = bounded(1, 2048);
    try {
      const observer = new QueryObserver(client, { queryKey: key(0), enabled: false });
      const unsubscribe = observer.subscribe(() => undefined);
      const visible = page("x".repeat(8192));
      client.setQueryData(key(0), visible);
      for (let index = 1; index < 10; index++) client.setQueryData(key(index), page("small"));
      expect(client.getQueryData(key(0))).toBe(visible);
      expect(observer.getCurrentResult().data).toBe(visible);
      expect(client.getQueryCache().getAll()).toHaveLength(2);
      unsubscribe();
      expect(client.getQueryData(key(0))).toBeUndefined();
      expect(client.getQueryData(key(9))).toEqual(page("small"));
    } finally {
      client.clear();
    }
  });

  test("keeps metadata and counts reusable while bounding both search caches", () => {
    const client = bounded(2);
    try {
      for (let index = 0; index < 40; index++) {
        client.setQueryData(key(index, "tables"), ["table"]);
        client.setQueryData(key(index, "count"), { count: 100, exact: true });
        client.setQueryData(key(index, "column-search"), [{ name: "column" }]);
        client.setQueryData(key(index, "source-search"), [{ source: "SELECT 1" }]);
      }
      expect(client.getQueryCache().getAll()).toHaveLength(82);
      expect(client.getQueryData(key(0, "tables"))).toEqual(["table"]);
      expect(client.getQueryData(key(0, "count"))).toEqual({ count: 100, exact: true });
    } finally {
      client.clear();
    }
  });

  test("lets an in-flight page finish and preserves request deduplication", async () => {
    const client = bounded(1);
    let finish: (value: ReturnType<typeof page>) => void = () => undefined;
    let calls = 0;
    const options = {
      queryKey: key(0),
      queryFn: () => {
        calls++;
        return new Promise<ReturnType<typeof page>>((resolve) => {
          finish = resolve;
        });
      },
    };
    try {
      const first = client.fetchQuery(options);
      for (let index = 1; index < 10; index++) client.setQueryData(key(index), page("cached"));
      const second = client.fetchQuery(options);
      finish(page("loaded"));
      expect(await first).toEqual(page("loaded"));
      expect(await second).toEqual(page("loaded"));
      expect(calls).toBe(1);
      expect(client.getQueryCache().getAll()).toHaveLength(1);
    } finally {
      client.clear();
    }
  });

  test("oversized results do not evict useful small pages", () => {
    const client = bounded(3, 1024);
    try {
      client.setQueryData(key(0), page("small"));
      client.setQueryData(key(1), page("x".repeat(4096)));
      expect(client.getQueryData(key(0))).toEqual(page("small"));
      expect(client.getQueryData(key(1))).toBeUndefined();
    } finally {
      client.clear();
    }
  });

  test("removal and clearing release accounting for replacement results", () => {
    const value = page("same size");
    const client = bounded(3, retainedDataBytes(value));
    try {
      client.setQueryData(key(0), value);
      client.removeQueries({ queryKey: key(0), exact: true });
      client.setQueryData(key(1), value);
      expect(client.getQueryData(key(1))).toEqual(value);
      client.clear();
      client.setQueryData(key(2), value);
      expect(client.getQueryData(key(2))).toEqual(value);
    } finally {
      client.clear();
    }
  });
});

test("memory accounting stops on very wide or deeply nested payloads without serializing them", () => {
  const wide = Array.from({ length: 100_000 }, () => 0);
  expect(retainedDataBytes(wide)).toBeGreaterThan(INACTIVE_QUERY_MAX_BYTES);
  let deep: unknown = "leaf";
  for (let depth = 0; depth < 100; depth++) deep = { child: deep };
  expect(retainedDataBytes(deep)).toBeGreaterThan(INACTIVE_QUERY_MAX_BYTES);
  const circular: Record<string, unknown> = { text: "small" };
  circular.self = circular;
  expect(retainedDataBytes(circular)).toBeLessThan(1024);
  expect(retainedDataBytes(new Uint8Array(4096))).toBeGreaterThanOrEqual(4096);
});
