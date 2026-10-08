import { afterEach, describe, expect, test } from "bun:test";
import { useSettingsStore } from "@/lib/settings";
import {
  recordCount,
  recordDatabaseOperation,
  recordDuration,
  recordUserQueryOutcome,
  recordView,
  recordViewActivity,
  setTelemetryClient,
  usageOutcome,
} from "@/lib/telemetry";
import { clearUsageStatistics, usageStatisticsStore } from "@/lib/usage-statistics";

function fakeSentry() {
  const calls: [string, string, number][] = [];
  const attributes: Record<string, string>[] = [];
  const client = {
    metrics: {
      count: (name: string, value: number, options: { attributes: Record<string, string> }) => {
        calls.push(["count", name, value]);
        attributes.push(options.attributes);
      },
      distribution: (
        name: string,
        value: number,
        options: { attributes: Record<string, string> },
      ) => {
        calls.push(["distribution", name, value]);
        attributes.push(options.attributes);
      },
    },
  };
  return {
    calls,
    attributes,
    client: client as unknown as Parameters<typeof setTelemetryClient>[0],
  };
}

afterEach(() => {
  setTelemetryClient(null);
  useSettingsStore.getState().setUsageMetrics(false);
  useSettingsStore.getState().setLocalUsageStats(false);
  clearUsageStatistics();
});

describe("telemetry", () => {
  test("sendet ohne Zustimmung nichts", () => {
    const { calls, client } = fakeSentry();
    recordCount("view.open", { route: "/" });
    setTelemetryClient(client);
    recordDuration("app.startup", 12.4, {});
    expect(calls).toEqual([]);
  });

  test("puffert bis der Client bereit ist", () => {
    useSettingsStore.getState().setUsageMetrics(true);
    const { calls, client } = fakeSentry();
    recordDuration("app.startup", 12.4, {});
    expect(calls).toEqual([]);
    setTelemetryClient(client);
    recordCount("view.open", { route: "/" });
    expect(calls).toEqual([
      ["distribution", "app.startup", 12],
      ["count", "view.open", 1],
    ]);
  });

  test("local recording does not enable remote sending and pauses without losing counts", () => {
    useSettingsStore.getState().setLocalUsageStats(true);
    const { calls, client } = fakeSentry();
    setTelemetryClient(client);
    recordView("/_app/_workspace/tables/$schema/$table", "query");
    recordViewActivity("tables", 123);
    recordDatabaseOperation("fetch_table_rows", "postgres", "ok", 20);
    recordUserQueryOutcome("postgres", new Error("Ausführung vom Benutzer abgebrochen."), 10);
    usageStatisticsStore.flush();
    const before = usageStatisticsStore.getSnapshot();
    expect(before.views).toEqual([{ view: "tables", opens: 1, activeMs: 123 }]);
    expect(before.operations.find((row) => row.operation === "user-query")?.cancelled).toBe(1);
    expect(calls).toEqual([]);
    useSettingsStore.getState().setLocalUsageStats(false);
    recordView("/query");
    recordDatabaseOperation("fetch_table_rows", "postgres", "error", 20);
    usageStatisticsStore.flush();
    expect(usageStatisticsStore.getSnapshot()).toEqual(before);
  });

  test("remote metrics use only static names and distinguish editor runs from commands", () => {
    useSettingsStore.getState().setUsageMetrics(true);
    const { calls, attributes, client } = fakeSentry();
    setTelemetryClient(client);
    recordView("/tables/private/customer", "/private-customer");
    recordViewActivity("private-customer", 20);
    recordDatabaseOperation("fetch_table_rows", "postgres://secret@host/database", "error", 20);
    recordDatabaseOperation("private-command", "postgres", "ok", 20);
    recordUserQueryOutcome("postgres", new Error("private-customer SQLSTATE 57014"), 10);
    expect(calls.map((call) => call[1])).toEqual([
      "view.open",
      "view.transition",
      "view.active.duration",
      "db.command.count",
      "db.command.duration",
      "user.query.count",
      "user.query.duration",
    ]);
    expect(attributes).toContainEqual({ route: "tables" });
    expect(attributes).toContainEqual({ from: "other", to: "tables" });
    expect(attributes).toContainEqual({
      command: "fetch_table_rows",
      operation: "browse",
      kind: "unknown",
      status: "error",
    });
    expect(attributes).toContainEqual({ kind: "postgres", status: "cancelled" });
    expect(JSON.stringify(attributes)).not.toMatch(/private|secret|host|database|SQLSTATE/);
    usageStatisticsStore.flush();
    expect(usageStatisticsStore.getSnapshot().sessionCount).toBe(0);
  });

  test("revoked consent drops buffered events, including after client initialization", () => {
    useSettingsStore.getState().setUsageMetrics(true);
    recordCount("session.start", {});
    setTelemetryClient(null, false);
    recordCount("view.open", { route: "query" });
    useSettingsStore.getState().setUsageMetrics(false);
    const { calls, client } = fakeSentry();
    setTelemetryClient(client);
    expect(calls).toEqual([]);
    useSettingsStore.getState().setUsageMetrics(true);
    recordCount("session.start", {});
    expect(calls).toEqual([["count", "session.start", 1]]);
  });

  test("pending metric queue and invalid durations stay bounded", () => {
    useSettingsStore.getState().setUsageMetrics(true);
    for (let index = 0; index < 1000; index++) recordCount("view.open", { route: "query" });
    const { calls, client } = fakeSentry();
    setTelemetryClient(client);
    expect(calls).toHaveLength(50);
    recordDuration("app.startup", Number.NaN, {});
    recordDuration("app.startup", -1, {});
    recordUserQueryOutcome("postgres", null, Number.POSITIVE_INFINITY);
    expect(calls).toHaveLength(50);
  });

  test("classifies timeouts as failures and explicit cancellations separately", () => {
    expect(usageOutcome(null)).toBe("ok");
    expect(usageOutcome("Ausführung vom Benutzer abgebrochen.")).toBe("cancelled");
    expect(usageOutcome("canceling statement due to user request SQLSTATE 57014")).toBe(
      "cancelled",
    );
    expect(usageOutcome("Query-Timeout: Abfrage vom Server abgebrochen.")).toBe("error");
    expect(usageOutcome("canceling statement due to lock timeout")).toBe("error");
    expect(usageOutcome(new Error("relation private-customer does not exist"))).toBe("error");
  });
});
