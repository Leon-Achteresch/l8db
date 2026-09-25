import { expect, mock, setSystemTime, test } from "bun:test";

let fail = true;
let calls = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd !== "list_providers") return null;
    calls += 1;
    if (fail) throw new Error("backend down");
    return [{ id: "oracle", kind: "oracle", url_schemes: ["oracle"], capabilities: {} }];
  },
}));

const { allProviders, loadProviders, useProvidersStore } = await import("@/lib/providers");

test("allProviders retries loading after a failed startup load", async () => {
  setSystemTime(new Date("2100-01-01"));
  useProvidersStore.setState({ loaded: false });
  const before = calls;
  await loadProviders();
  expect(useProvidersStore.getState().loaded).toBe(false);
  fail = false;
  allProviders();
  await Bun.sleep(0);
  expect(allProviders().some((p) => p.kind === "oracle")).toBe(true);
  expect(calls - before).toBe(2);
  setSystemTime();
});
