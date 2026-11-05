import { expect, mock, test } from "bun:test";

const calls: unknown[] = [];
mock.module("../src/lib/db/core", () => ({
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
  },
}));
mock.module("../src/lib/extensions/management", () => ({ assertExtensionsAllowed: () => {} }));
const { finishUiPluginProposal } = await import("../src/lib/db/ui-plugins");

test("Freigaben übertragen nur die ursprünglichen Vorschlagsfelder", async () => {
  const request = {
    slot: 0,
    nonce: "fixture",
    action: "write" as const,
    name: "fixture.tsx",
    source: "x".repeat(256 * 1024),
    before: null,
  };
  const enriched = { ...request, http: ["https://example.org"] };
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await finishUiPluginProposal(
      enriched,
      { decision: i % 2 ? "accepted" : "rejected" },
      !!(i % 2),
    );
    times.push(performance.now() - start);
  }
  expect(calls).toHaveLength(100);
  for (const call of calls) {
    expect((call as { args: { request: unknown } }).args.request).toEqual(request);
  }
  times.sort((a, b) => a - b);
  console.log(`proposal bridge 256KiB n=100 median=${times[50]}ms p95=${times[95]}ms`);
  expect(times[95]).toBeLessThan(10);
});
