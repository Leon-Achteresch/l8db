import { afterEach, describe, expect, mock, test } from "bun:test";

const calls: { command: string; args: unknown }[] = [];
let synchronize: () => Promise<void> = async () => {};
let execute: () => Promise<unknown> = async () => ({ result: { columns: [], rows: [] } });

mock.module("@/lib/automation/sync", () => ({ syncAutomationConnectionsNow: () => synchronize() }));
mock.module("@/lib/db/core", () => ({
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    return command === "federation_query"
      ? execute()
      : { databases: [], schemas: [], tables: [], hasMore: false };
  },
  cancelExecution: async (jobId: string) => {
    calls.push({ command: "cancel_execution", args: { jobId } });
    return true;
  },
}));

const { federationCatalog, queryFederation } = await import("../src/lib/db/federation");
const source = {
  connectionId: "saved-id",
  database: null,
  schema: "main",
  table: "items",
  alias: "src",
};

afterEach(() => {
  calls.length = 0;
  synchronize = async () => {};
  execute = async () => ({ result: { columns: [], rows: [] } });
});

describe("federation transport", () => {
  test("synchronizes saved descriptors and sends source IDs without connection URLs", async () => {
    let synchronized = false;
    synchronize = async () => {
      synchronized = true;
    };
    await federationCatalog("saved-id", null, "main");
    expect(synchronized).toBe(true);
    expect(calls[0]).toEqual({
      command: "federation_catalog",
      args: {
        connectionId: "saved-id",
        database: undefined,
        schema: "main",
        options: { jobId: expect.any(String), queryTimeout: 20 },
      },
    });
    await queryFederation([source], "SELECT * FROM src.items", { jobId: "federation-test" });
    expect(calls[1]).toEqual({
      command: "federation_query",
      args: {
        request: { sources: [source], sql: "SELECT * FROM src.items" },
        options: { jobId: "federation-test" },
      },
    });
    expect(JSON.stringify(calls)).not.toContain("connectionString");
  });

  test("aborting during descriptor sync ends immediately and never starts a query", async () => {
    synchronize = () => new Promise(() => {});
    const controller = new AbortController();
    const request = queryFederation(
      [source],
      "SELECT 1",
      { jobId: "not-started" },
      controller.signal,
    );
    controller.abort();
    await expect(request).rejects.toThrow("abgebrochen");
    expect(calls).toEqual([]);
  });

  test("aborting an active query cancels its job and performs no idle polling", async () => {
    execute = () => new Promise(() => {});
    const controller = new AbortController();
    const request = queryFederation([source], "SELECT 1", { jobId: "active" }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(request).rejects.toThrow("abgebrochen");
    expect(calls.map((call) => call.command)).toEqual(["federation_query", "cancel_execution"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toHaveLength(2);
  });

  test("a previously aborted request does not synchronize or contact the backend", async () => {
    let syncs = 0;
    synchronize = async () => {
      syncs++;
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      queryFederation([source], "SELECT 1", undefined, controller.signal),
    ).rejects.toThrow("abgebrochen");
    expect(syncs).toBe(0);
    expect(calls).toEqual([]);
  });
});
