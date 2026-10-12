import { expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { ManagedObject } from "../src/lib/versioning/types";

const db = { ...(await import("../src/lib/db")) };
const queryOptions: unknown[] = [];

mock.module("../src/lib/db", () => ({
  ...db,
  executeQuery: async (...args: unknown[]) => {
    queryOptions.push(args[4]);
    return { columns: [], rows: [] };
  },
  listTableColumnsDetailed: async () => [
    { name: "ID", data_type: "NUMBER", is_nullable: false, default_value: null },
  ],
  listConstraints: async () => [],
  listIndexes: async () => [],
  listTriggers: async () => [],
  getFunctionDefinition: async (_kind: unknown, _url: unknown, oid: string) => {
    if (oid.endsWith("PACKAGE BODY")) throw new Error("ORA-04043");
    return "PACKAGE app_pkg IS END;";
  },
}));

const { captureObject } = await import("../src/lib/versioning/capture");

const connection = {
  id: "oracle",
  kind: "oracle",
  connectionString: "oracle://test@localhost/FREEPDB1",
} as SavedConnection;

const object = (objectType: "table" | "package", objectName: string): ManagedObject => ({
  id: objectName,
  path: `database/objects/${objectName}.sql`,
  metadataVersion: 3,
  selection: { schema: "ETL_TEST", objectType, objectName, objectOid: null },
});

test("Oracle metadata reads during capture stay out of the SQL task list", async () => {
  queryOptions.length = 0;
  await captureObject(connection, null, object("table", "AUFTRAG"));
  await captureObject(connection, null, object("package", "APP_PKG"));
  expect(queryOptions).toHaveLength(3);
  for (const options of queryOptions) expect(options).toMatchObject({ track: false });
});
