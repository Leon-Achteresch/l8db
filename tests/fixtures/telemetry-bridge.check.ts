import { expect, mock, test } from "bun:test";

let requests = 0;
let active = 0;
let peak = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (_command: string, args?: Record<string, unknown>) => {
    requests++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (Object.hasOwn(args ?? {}, "failure")) throw args?.failure;
    return { rows: [], columns: [] };
  },
}));

const { invoke, registerReadOnlyResolver, READ_ONLY_MESSAGE } = await import(
  "../../src/lib/db/core"
);
const { useSettingsStore } = await import("../../src/lib/settings");
const { usageStatisticsStore, clearUsageStatistics } = await import(
  "../../src/lib/usage-statistics"
);

test("outcomes are counted once without more requests or retries", async () => {
  clearUsageStatistics();
  useSettingsStore.getState().setLocalUsageStats(true);
  try {
    const results = await Promise.allSettled([
      invoke("fetch_table_rows", { kind: "sqlite" }),
      invoke("fetch_table_rows", { kind: "sqlite" }),
      invoke("fetch_table_rows", { kind: "sqlite", failure: null }),
      invoke("test_connection_string", {
        kind: "postgres",
        failure: "Ausführung vom Benutzer abgebrochen.",
      }),
      invoke("test_connection_string", {
        kind: "postgres",
        failure: "Query-Timeout: Abfrage vom Server abgebrochen.",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(requests).toBe(5);
    expect(peak).toBe(5);
    expect(active).toBe(0);
    const previous = registerReadOnlyResolver(() => true);
    try {
      await expect(invoke("execute_in_transaction", { kind: "sqlite" })).rejects.toThrow(
        READ_ONLY_MESSAGE,
      );
    } finally {
      registerReadOnlyResolver(previous);
    }
    expect(requests).toBe(5);
    usageStatisticsStore.flush();
    const data = usageStatisticsStore.getSnapshot();
    expect(data.operations.find((row) => row.operation === "browse")).toMatchObject({
      ok: 2,
      error: 1,
      cancelled: 0,
    });
    expect(data.operations.find((row) => row.operation === "connect")).toMatchObject({
      ok: 0,
      error: 1,
      cancelled: 1,
    });
    expect(data.operations.find((row) => row.operation === "query")).toMatchObject({
      ok: 0,
      error: 1,
      cancelled: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(requests).toBe(5);
  } finally {
    useSettingsStore.getState().setLocalUsageStats(false);
    clearUsageStatistics();
  }
});
