import { expect, mock, test } from "bun:test";

const prompts: unknown[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "list_transactions" ? [] : null),
}));
mock.module("../src/lib/sql-confirmation", () => ({
  requestSqlConfirmation: async (request: unknown) => {
    prompts.push(request);
    return true;
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useSettingsStore } = await import("../src/lib/settings");
const { confirmSqlExecution, READ_ONLY_MESSAGE } = await import("../src/lib/db/core");
const { effectiveConnectionString } = await import("../src/lib/ssh");

const url = "redis://127.0.0.1:6381/3";
const connection = (id: string, extra: Record<string, unknown>) =>
  ({ id, name: id, kind: "redis", sslMode: "prefer", connectionString: url, ...extra }) as never;

test("Redis read-only connection refuses FLUSHDB before asking for confirmation", async () => {
  useSettingsStore.setState({ confirmDestructiveQueries: true });
  useConnectionsStore.setState({
    connections: [
      connection("Redis Produktion", { environment: "production" }),
      connection("Redis Nur Lesen", { readOnly: true }),
    ],
  });
  const target = effectiveConnectionString(useConnectionsStore.getState().connections[1]);
  await expect(confirmSqlExecution("redis", target, "FLUSHDB", "3")).rejects.toThrow(
    READ_ONLY_MESSAGE,
  );
  await expect(confirmSqlExecution("redis", target, "SHUTDOWN", "3")).rejects.toThrow(
    READ_ONLY_MESSAGE,
  );
  expect(prompts).toHaveLength(0);
  await confirmSqlExecution("redis", target, "GET a", "3");
  expect(prompts).toHaveLength(0);
});

test("Redis confirmation names the active connection, not another one on the same URL", async () => {
  useSettingsStore.setState({ confirmDestructiveQueries: true });
  prompts.length = 0;
  useConnectionsStore.setState({
    connections: [
      connection("Redis Produktion", { environment: "production" }),
      connection("Redis Test DB 3", {}),
    ],
  });
  const target = effectiveConnectionString(useConnectionsStore.getState().connections[1]);
  await confirmSqlExecution("redis", target, "FLUSHDB", "3", undefined, "Redis Test DB 3");
  expect(prompts).toHaveLength(1);
  expect((prompts[0] as { connection: string }).connection).toBe(
    "Redis Test DB 3 · gleiche Adresse wie Redis Produktion",
  );
  useConnectionsStore.setState({ connections: [connection("Redis Test DB 3", {})] });
  await confirmSqlExecution("redis", target, "FLUSHDB", "3", undefined, "Redis Test DB 3");
  expect((prompts[1] as { connection: string }).connection).toBe("Redis Test DB 3");
});
