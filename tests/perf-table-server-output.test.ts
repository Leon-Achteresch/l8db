import { heapStats } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const messages = Array.from({ length: 2_000 }, (_, i) => ({
  level: "NOTICE",
  message: `message-${i}`,
  detail: null,
}));
let requests = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command !== "transaction_server_output") throw Error(command);
    requests++;
    return messages;
  },
}));
const { withTableServerOutput } = await import("../src/lib/table-server-output");
const { useServerOutputStore, MAX_SERVER_OUTPUT_ENTRIES, serverOutputForDatabase } = await import(
  "../src/lib/server-output"
);
const { useProvidersStore, POSTGRES_CAPABILITIES } = await import("../src/lib/providers");

test("existing bounded output history drains once per completed grid operation and stays idle otherwise", async () => {
  const conn = { id: "perf-output", kind: "postgres" } as SavedConnection;
  useProvidersStore.setState({
    loaded: true,
    providers: [{ id: "postgres", kind: "postgres", capabilities: POSTGRES_CAPABILITIES }] as never,
  });
  useServerOutputStore.getState().setEnabled(conn.id, true);
  useServerOutputStore.getState().append(
    conn.id,
    "other",
    Array.from({ length: MAX_SERVER_OUTPUT_ENTRIES }, () => messages[0]),
  );
  Bun.gc(true);
  const before = heapStats().heapSize;
  const delivery = await measureScenario(async () => {
    await withTableServerOutput(conn, "db", "tx", async () => 1);
  }, 11);
  const entries = useServerOutputStore.getState().entries[conn.id];
  expect(entries).toHaveLength(MAX_SERVER_OUTPUT_ENTRIES);
  const filtering = await measureScenario(() => {
    serverOutputForDatabase(entries, "db");
  }, 11);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  const idle = requests;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(requests).toBe(idle);
  expect(requests).toBe(13);
  reportScenario("table-server-output", {
    history: entries.length,
    messagesPerOperation: messages.length,
    delivery,
    filtering,
    retainedBytes,
    requests,
    idleRequests: 0,
    polling: false,
    bun: Bun.version,
  });
  expect(delivery.medianMs).toBeLessThan(50);
  expect(delivery.p95Ms).toBeLessThan(100);
  expect(filtering.p95Ms).toBeLessThan(25);
  expect(retainedBytes).toBeLessThan(32 * 1024 * 1024);
});
