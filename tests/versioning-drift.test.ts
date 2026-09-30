import { afterAll, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { ManagedObject, VersioningProject } from "../src/lib/versioning/types";

const files = new Map<string, string>();
const database: Record<string, string> = { orders: "CREATE TABLE orders(id int)", fresh: "x", L8DB_VERSIONING_POLICY: "internal", L8DB_VERSIONING_JOURNAL: "internal" };

const repository = { ...(await import("../src/lib/versioning/repository")) };
const definitions = { ...(await import("../src/lib/compare-definition")) };
const capture = { ...(await import("../src/lib/versioning/capture")) };

mock.module("../src/lib/versioning/repository", () => ({
  ...repository,
  encode: (value: unknown) => `${JSON.stringify(value, null, 2)}\n`,
  readFile: async (_repo: string, path: string) => files.get(path) ?? null,
  saveFile: async (_repo: string, path: string, content: string, expected: string | null) => {
    if ((files.get(path) ?? null) !== expected) throw new Error(`conflict ${path}`);
    files.set(path, content);
  },
  deleteFile: async (_repo: string, path: string) => {
    files.delete(path);
  },
}));
mock.module("../src/lib/compare-definition", () => ({
  ...definitions,
  listCompareObjects: async (_connection: unknown, side: { objectType: string }) =>
    side.objectType === "table" ? Object.keys(database).map((name) => ({ name, oid: null })) : [],
}));
mock.module("../src/lib/versioning/capture", () => ({
  ...capture,
  captureObject: async (_connection: unknown, _database: unknown, object: ManagedObject) => ({
    object,
    definition: database[object.selection.objectName ?? ""],
    checksum: "",
  }),
}));

const { saveDrift, scanDrift } = await import("../src/lib/versioning/drift");

const managed = (name: string): ManagedObject => ({
  id: name,
  path: `database/objects/${name}.sql`,
  selection: { schema: "app", objectType: "table", objectName: name, objectOid: null },
});

test("detects changed, new and dropped objects and writes the database state back", async () => {
  const project: VersioningProject = {
    format: 1,
    id: "p",
    name: "P",
    kind: "mysql",
    objects: [managed("orders"), managed("gone")],
  };
  files.set("database/objects/orders.sql", "CREATE TABLE orders(id bigint)\n");
  files.set("database/objects/gone.sql", "CREATE TABLE gone(id int)\n");
  const projectText = JSON.stringify(project);
  files.set("database/project.json", projectText);
  const connection = { id: "c", kind: "mysql" } as SavedConnection;
  const source = {
    connectionId: "c",
    database: null,
    schema: "app",
    objectType: "table" as const,
    objectName: null,
    objectOid: null,
  };
  const entries = await scanDrift("/r", project, connection, source, () => {});
  expect(entries.map((entry) => [entry.object.selection.objectName, entry.status])).toEqual([
    ["orders", "changed"],
    ["fresh", "added"],
    ["gone", "removed"],
  ]);
  await saveDrift("/r", project, projectText, entries);
  expect(files.get("database/objects/orders.sql")).toBe("CREATE TABLE orders(id int)\n");
  expect(files.has("database/objects/gone.sql")).toBe(false);
  const saved = JSON.parse(files.get("database/project.json") ?? "") as VersioningProject;
  expect(saved.objects.map((object) => object.selection.objectName)).toEqual(["orders", "fresh"]);
  expect(await scanDrift("/r", saved, connection, source, () => {})).toEqual([]);
});

afterAll(() => {
  mock.module("../src/lib/versioning/repository", () => repository);
  mock.module("../src/lib/compare-definition", () => definitions);
  mock.module("../src/lib/versioning/capture", () => capture);
});
