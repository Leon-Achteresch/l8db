import { describe, expect, mock, test } from "bun:test";

const liveTables: Record<string, Array<Record<string, unknown>>> = {
  users: [
    {
      name: "id",
      data_type: "integer",
      is_nullable: false,
      column_default: null,
      is_primary_key: true,
      ordinal_position: 1,
      character_maximum_length: null,
    },
  ],
};

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "list_tables") {
      return Object.keys(liveTables).map((name) => ({ name, schema: args.schema }));
    }
    if (command === "list_table_columns_detailed") {
      return liveTables[args.table as string] ?? [];
    }
    throw new Error(`unexpected ${command}`);
  },
}));

const { collectExistingTables } = await import(
  "@/features/compare/schema-snapshot-view/collect-tables"
);
const { buildSnapshot, buildSnapshotTable, diffSnapshots } = await import("@/lib/schema-snapshot");

const connection = {
  id: "c1",
  name: "Lokal",
  kind: "postgres",
  connectionString: "postgres://u@localhost/app",
  ssh: null,
  tunnelPort: null,
} as never;

const scope = {
  connection_name: "Lokal",
  kind: "postgres",
  database: "app",
  schema: "public",
  requested_tables: ["orders", "users"],
};

describe("Snapshot-Vergleich gegen aktuellen Stand", () => {
  test("meldet gelöschte Tabellen als table_removed statt als entfernte Spalten", async () => {
    const base = buildSnapshot(scope, [
      buildSnapshotTable("public", "users", liveTables.users as never),
      buildSnapshotTable("public", "orders", [
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          column_default: null,
          is_primary_key: true,
          ordinal_position: 1,
          character_maximum_length: null,
        },
        {
          name: "total",
          data_type: "numeric",
          is_nullable: true,
          column_default: null,
          is_primary_key: false,
          ordinal_position: 2,
          character_maximum_length: null,
        },
      ]),
    ]);
    const collected = await collectExistingTables(
      connection,
      "app",
      "public",
      base.scope.requested_tables,
    );
    const diff = diffSnapshots(base, buildSnapshot(scope, collected));
    expect(diff.map((entry) => [entry.kind, entry.table, entry.column])).toEqual([
      ["table_removed", "public.orders", null],
    ]);
  });
});
