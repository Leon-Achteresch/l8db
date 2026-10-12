import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  loadSharedSchemaObjects,
  runSchemaMetadataRequest,
} from "../src/lib/queries/schema-object-loading";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function fixture(delay: number | null = null, cancelSettles = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = {
    tables: Array.from({ length: 5000 }, (_, index) => ({
      schema: "public",
      name: `table_${index}`,
    })),
    views: Array.from({ length: 1000 }, (_, index) => ({
      schema: "public",
      name: `view_${index}`,
    })),
    functions: Array.from({ length: 900 }, (_, index) => ({
      schema: "public",
      name: `function_${index}`,
    })),
    procedures: Array.from({ length: 900 }, (_, index) => ({
      schema: "public",
      name: `procedure_${index}`,
    })),
  };
  type Data = typeof data;
  const pending = new Map<string, { key: keyof Data; finish: () => void; cancel: () => void }>();
  const calls: (keyof Data)[] = [];
  const cancellations: string[] = [];
  let active = 0;
  let maxConcurrency = 0;
  const cancel = (jobId: string) => {
    cancellations.push(jobId);
    if (cancelSettles) pending.get(jobId)?.cancel();
  };
  const queries = Object.fromEntries(
    Object.keys(data).map((key) => {
      const type = key as keyof Data;
      const root = type === "tables" ? "all-tables" : type === "views" ? "all-views" : type;
      return [
        type,
        {
          queryKey: [
            root,
            "perf",
            "database",
            ...(type === "tables" || type === "views" ? [] : [undefined]),
          ],
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            runSchemaMetadataRequest(
              client,
              "perf",
              signal,
              (jobId) => {
                calls.push(type);
                active++;
                maxConcurrency = Math.max(maxConcurrency, active);
                return new Promise<Data[typeof type]>((resolve, reject) => {
                  let timer: ReturnType<typeof setTimeout> | undefined;
                  const cleanup = () => {
                    clearTimeout(timer);
                    pending.delete(jobId);
                    active--;
                  };
                  const finish = () => {
                    cleanup();
                    resolve(data[type]);
                  };
                  pending.set(jobId, {
                    key: type,
                    finish,
                    cancel: () => {
                      cleanup();
                      reject(new Error("Abfrage vom Server abgebrochen"));
                    },
                  });
                  if (delay !== null) timer = setTimeout(finish, delay);
                });
              },
              cancel,
            ),
        },
      ];
    }),
  ) as {
    [Key in keyof Data]: {
      queryKey: readonly unknown[];
      queryFn: (context: { signal: AbortSignal }) => Promise<Data[Key]>;
    };
  };
  const options = {
    queryKey: ["all-objects", "perf", "database"],
    staleTime: 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      loadSharedSchemaObjects(client, signal, queries),
  };
  return {
    client,
    data,
    queries,
    options,
    pending,
    calls,
    cancellations,
    active: () => active,
    maxConcurrency: () => maxConcurrency,
    finish: (key?: keyof Data) => {
      for (const request of [...pending.values()])
        if (!key || request.key === key) request.finish();
    },
  };
}

test("64 schema consumers share 7,800 objects, bounded concurrent reads and fresh cached arrays", async () => {
  let requests = 0;
  let concurrency = 0;
  let retainedQueries = 0;
  const cold = await measureScenario(async () => {
    const state = fixture(8);
    const observers = Array.from(
      { length: 64 },
      () => new QueryObserver(state.client, state.options),
    );
    const stops = observers.map((observer) => observer.subscribe(() => undefined));
    try {
      const result = await state.client.fetchQuery(state.options);
      for (const key of Object.keys(state.data) as (keyof typeof state.data)[]) {
        expect(result[key]).toBe(state.data[key]);
        expect(state.client.getQueryData(state.queries[key].queryKey)).toBe(state.data[key]);
      }
      for (const observer of observers) expect(observer.getCurrentResult().data).toBe(result);
      requests = state.calls.length;
      concurrency = state.maxConcurrency();
      retainedQueries = state.client.getQueryCache().getAll().length;
      expect(requests).toBe(4);
      expect(concurrency).toBe(2);
      expect(retainedQueries).toBe(5);
    } finally {
      for (const stop of stops) stop();
      state.client.clear();
    }
  });
  const state = fixture(8);
  try {
    await state.client.fetchQuery(state.options);
    const warm = await measureScenario(async () => {
      const result = await Promise.all(
        Array.from({ length: 64 }, () => state.client.fetchQuery(state.options)),
      );
      expect(result.every((objects) => objects.tables === state.data.tables)).toBe(true);
    });
    await wait(40);
    expect(state.calls.length).toBe(4);
    expect(state.active()).toBe(0);
    await reportScenario("schema-object-shared-reads", {
      cold,
      warm,
      consumers: 64,
      objects: 7800,
      simulatedLatencyMs: 8,
      databaseRequests: requests,
      maxConcurrency: concurrency,
      retainedQueries,
      copiedObjectArrays: 0,
      warmRequests: 0,
      idleRequests: 0,
    });
    expect(cold.p95Ms).toBeLessThan(120);
    expect(warm.p95Ms).toBeLessThan(20);
  } finally {
    state.client.clear();
  }
});

test("abandoned metadata cancels two dispatched reads, discards the queue and remains idle", async () => {
  const state = fixture();
  const observer = new QueryObserver(state.client, state.options);
  const stop = observer.subscribe(() => undefined);
  await wait(0);
  expect(state.calls).toEqual(["tables", "views"]);
  stop();
  await wait(10);
  expect(state.cancellations.length).toBe(2);
  expect(state.active()).toBe(0);
  expect(state.pending.size).toBe(0);
  expect(state.client.getQueryData(state.options.queryKey)).toBeUndefined();
  expect(
    state.client
      .getQueryCache()
      .getAll()
      .every((query) => query.getObserversCount() === 0 && query.state.fetchStatus === "idle"),
  ).toBe(true);
  await wait(40);
  expect(state.calls).toEqual(["tables", "views"]);
  await reportScenario("schema-object-abandonment", {
    queuedReads: 2,
    queuedDispatched: 0,
    dispatchedReads: 2,
    cancelledReads: 2,
    retainedJobs: state.pending.size,
    activeReads: state.active(),
    idleReads: 0,
  });
  state.client.clear();
});

test("closing the palette preserves a metadata read another feature still observes", async () => {
  const state = fixture();
  const tableObserver = new QueryObserver(state.client, {
    ...state.queries.tables,
    staleTime: 60_000,
  });
  const stopTable = tableObserver.subscribe(() => undefined);
  const observer = new QueryObserver(state.client, state.options);
  const stopPalette = observer.subscribe(() => undefined);
  try {
    await wait(0);
    const tableJob = [...state.pending.entries()].find(([, value]) => value.key === "tables")?.[0];
    stopPalette();
    await wait(10);
    expect(state.cancellations).toHaveLength(1);
    expect(state.cancellations).not.toContain(tableJob);
    expect(state.active()).toBe(1);
    state.finish("tables");
    await wait(0);
    expect(tableObserver.getCurrentResult().data).toBe(state.data.tables);
    expect(state.calls).toEqual(["tables", "views"]);
    await reportScenario("schema-object-shared-abandonment", {
      databaseRequests: 2,
      cancelledReads: 1,
      preservedReaders: 1,
      queuedDispatched: 0,
    });
  } finally {
    stopPalette();
    stopTable();
    state.finish();
    state.client.clear();
  }
});

test("unsupported cancellation retains its physical slots and never starts an abandoned queued read", async () => {
  const state = fixture(null, false);
  const observer = new QueryObserver(state.client, state.options);
  const first = observer.subscribe(() => undefined);
  await wait(0);
  first();
  await wait(0);
  for (let index = 0; index < 20; index++) {
    const stop = observer.subscribe(() => undefined);
    await wait(0);
    stop();
  }
  expect(state.calls).toEqual(["tables", "views"]);
  expect(state.active()).toBe(2);
  state.finish();
  await wait(0);
  expect(state.active()).toBe(0);
  expect(state.pending.size).toBe(0);
  expect(state.maxConcurrency()).toBe(2);
  expect(state.calls).toHaveLength(2);
  const again = observer.subscribe(() => undefined);
  await wait(0);
  expect(state.calls).toHaveLength(4);
  again();
  state.finish();
  await wait(0);
  await reportScenario("schema-object-unconfirmed-cancel", {
    rapidReopens: 20,
    databaseRequestsBeforeCompletion: 2,
    maxConcurrency: 2,
    queuedDispatchedAfterAbandonment: 0,
    retainedJobs: state.pending.size,
  });
  state.client.clear();
});

test("aborting before transport dispatch starts no database job and releases the scope", async () => {
  const client = new QueryClient();
  const controller = new AbortController();
  let requests = 0;
  let cancellations = 0;
  const pending = runSchemaMetadataRequest(
    client,
    "perf",
    controller.signal,
    async () => ++requests,
    () => {
      cancellations++;
    },
  );
  controller.abort();
  await expect(pending).rejects.toBeDefined();
  await wait(0);
  expect(requests).toBe(0);
  expect(cancellations).toBe(0);
  const next = new AbortController();
  expect(
    await runSchemaMetadataRequest(
      client,
      "perf",
      next.signal,
      async () => ++requests,
      () => undefined,
    ),
  ).toBe(1);
  client.clear();
});

test("an explicit metadata refresh shares existing canonical observers and starts four reads once", async () => {
  const state = fixture(8);
  const palette = new QueryObserver(state.client, state.options);
  const stopPalette = palette.subscribe(() => undefined);
  const table = new QueryObserver(state.client, { ...state.queries.tables, staleTime: 60_000 });
  const stopTable = table.subscribe(() => undefined);
  const view = new QueryObserver(state.client, { ...state.queries.views, staleTime: 60_000 });
  const stopView = view.subscribe(() => undefined);
  try {
    await state.client.fetchQuery(state.options);
    expect(state.calls).toHaveLength(4);
    await state.client.invalidateQueries({ predicate: (query) => query.queryKey[1] === "perf" });
    expect(state.calls).toHaveLength(8);
    for (const key of Object.keys(state.data) as (keyof typeof state.data)[]) {
      expect(state.calls.filter((type) => type === key)).toHaveLength(2);
    }
    expect(state.maxConcurrency()).toBe(2);
    expect(state.active()).toBe(0);
    expect(palette.getCurrentResult().data?.tables).toBe(state.data.tables);
    expect(table.getCurrentResult().data).toBe(state.data.tables);
    await reportScenario("schema-object-refresh-shared-readers", {
      activeFeatures: 3,
      initialRequests: 4,
      refreshRequests: 4,
      maxConcurrency: 2,
    });
  } finally {
    stopPalette();
    stopTable();
    stopView();
    state.client.clear();
  }
});
