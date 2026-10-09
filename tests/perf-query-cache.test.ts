import { expect, test } from "bun:test";
import { QueryObserver } from "@tanstack/react-query";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  INACTIVE_QUERY_MAX_BYTES,
  INACTIVE_QUERY_MAX_ENTRIES,
  retainedDataBytes,
} from "../src/lib/query-cache-budget";
import { createAppQueryClient } from "../src/lib/query-client";

test("browsing 200 result pages stays within the inactive memory and latency budgets", async () => {
  let retainedPages = 0;
  let retainedBytes = 0;
  const timing = await measureScenario(() => {
    const client = createAppQueryClient();
    try {
      for (let page = 0; page < 200; page++) {
        client.setQueryData(["rows", "perf", "database", "public", "items", page], {
          columns: ["text"],
          rows: Array.from({ length: 100 }, (_, row) => ({
            text: `${page}/${row}: ${"x".repeat(1024)}`,
          })),
        });
      }
      const queries = client.getQueryCache().getAll();
      retainedPages = queries.length;
      retainedBytes = queries.reduce((sum, query) => sum + retainedDataBytes(query.state.data), 0);
      expect(retainedPages).toBeLessThanOrEqual(INACTIVE_QUERY_MAX_ENTRIES);
      expect(retainedBytes).toBeLessThanOrEqual(INACTIVE_QUERY_MAX_BYTES);
      expect(
        client.getQueryData(["rows", "perf", "database", "public", "items", 199]),
      ).toBeDefined();
    } finally {
      client.clear();
    }
  });
  await reportScenario("query-cache-pages", {
    ...timing,
    pagesVisited: 200,
    retainedPages,
    retainedBytes,
  });
  expect(timing.p95Ms).toBeLessThan(500);
});

test("64 simultaneous feature consumers share one metadata request and cache until refresh", async () => {
  const client = createAppQueryClient();
  let calls = 0;
  let finish: (value: string[]) => void = () => undefined;
  const options = {
    queryKey: ["tables", "perf", "database", "public"],
    queryFn: () => {
      calls++;
      return new Promise<string[]>((resolve) => {
        finish = resolve;
      });
    },
  };
  try {
    const pending = Array.from({ length: 64 }, () => client.fetchQuery(options));
    finish(["items"]);
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 64 }, () => ["items"]));
    const timing = await measureScenario(async () => {
      await Promise.all(Array.from({ length: 64 }, () => client.fetchQuery(options)));
    });
    expect(calls).toBe(1);
    expect(timing.p95Ms).toBeLessThan(100);
    await client.invalidateQueries({ queryKey: options.queryKey, exact: true });
    const refreshed = client.fetchQuery(options);
    finish(["items", "new_table"]);
    expect(await refreshed).toEqual(["items", "new_table"]);
    expect(calls).toBe(2);
    await reportScenario("query-cache-database-load", {
      ...timing,
      consumers: 64,
      requestsBeforeRefresh: 1,
      requestsAfterRefresh: calls,
    });
  } finally {
    client.clear();
  }
});

test("memory pressure keeps visible data and never refetches it", async () => {
  const client = createAppQueryClient();
  let calls = 0;
  const visible = {
    queryKey: ["rows", "perf", "database", "public", "visible"],
    queryFn: async () => {
      calls++;
      return { columns: ["id"], rows: [{ id: 1 }] };
    },
  };
  const observer = new QueryObserver(client, visible);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    const original = await client.fetchQuery(visible);
    for (let index = 0; index < 500; index++)
      client.setQueryData(["rows", "perf", "database", "public", "other", index], {
        columns: ["id"],
        rows: [{ id: index }],
      });
    expect(calls).toBe(1);
    expect(observer.getCurrentResult().data).toBe(original);
    expect(client.getQueryData(visible.queryKey)).toBe(original);
    expect(client.getQueryCache().getAll().length).toBeLessThanOrEqual(
      INACTIVE_QUERY_MAX_ENTRIES + 1,
    );
    await reportScenario("query-cache-visible", { pagesVisited: 500, requests: calls });
  } finally {
    unsubscribe();
    client.clear();
  }
});
