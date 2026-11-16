import { expect, mock, test } from "bun:test";
import type { IndexInfo } from "../src/lib/db/schema-objects";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let response: IndexInfo[] = [];
mock.module("../src/lib/db/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return response;
  },
}));
const { listIndexes } = await import("../src/lib/db/schema-objects");

test("existing list_indexes transports optional roles in one request without a follow-up query", async () => {
  response = [
    {
      name: "ix",
      is_unique: false,
      is_primary: false,
      columns: ["id"],
      index_type: "nonclustered",
      definition: "",
      roles: {
        keys: [{ name: "id", position: 1, descending: false }],
        included: ["label"],
        other: [],
        filter: { state: "unavailable" },
        definition_status: "unavailable",
      },
    },
  ];
  expect(await listIndexes("mssql", "fixture://no-network", "dbo", "items", "fixture_db")).toEqual(
    response,
  );
  expect(calls).toEqual([
    {
      command: "list_indexes",
      args: {
        kind: "mssql",
        connectionString: "fixture://no-network",
        database: "fixture_db",
        schema: "dbo",
        table: "items",
      },
    },
  ]);
});

test("unchanged provider response needs no role fields", async () => {
  const legacy: IndexInfo = {
    name: "pk",
    is_unique: true,
    is_primary: true,
    columns: ["id"],
    index_type: "btree",
    definition: "native definition",
  };
  response = [legacy];
  const before = calls.length;
  expect(await listIndexes("postgres", "fixture://no-network", "public", "items")).toEqual([
    legacy,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls.length - before).toBe(1);
  expect(response[0]).not.toHaveProperty("roles");
});
