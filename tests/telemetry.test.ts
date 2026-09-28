import { afterEach, describe, expect, test } from "bun:test";
import { useSettingsStore } from "@/lib/settings";
import { recordCount, recordDuration, setTelemetryClient } from "@/lib/telemetry";

function fakeSentry() {
  const calls: [string, string, number][] = [];
  const client = {
    metrics: {
      count: (name: string, value: number) => calls.push(["count", name, value]),
      distribution: (name: string, value: number) => calls.push(["distribution", name, value]),
    },
  };
  return { calls, client: client as unknown as Parameters<typeof setTelemetryClient>[0] };
}

afterEach(() => {
  setTelemetryClient(null);
  useSettingsStore.getState().setUsageMetrics(false);
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
});
