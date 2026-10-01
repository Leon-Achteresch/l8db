import { afterAll, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import { useProvidersStore } from "../src/lib/providers";
import type { ManagedObject, VersioningProject } from "../src/lib/versioning/types";

const files = new Map<string, string>();
const database: Record<string, string> = {
  orders: "CREATE TABLE orders(id int)",
  fresh: "x",
  L8DB_VERSIONING_POLICY: "internal",
  L8DB_VERSIONING_JOURNAL: "internal",
};

const repository = { ...(await import("../src/lib/versioning/repository")) };
const definitions = { ...(await import("../src/lib/compare-definition")) };
const capture = { ...(await import("../src/lib/versioning/capture")) };
const db = { ...(await import("../src/lib/db")) };
const sequences = ["ISEQ$$_123", "ISEQ$$_USER", "APP_SEQUENCE"];

mock.module("../src/lib/db", () => ({
  ...db,
  executeQuery: async () => ({ rows: [{ sequence: "ISEQ$$_123" }] }),
}));

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
  listCompareObjects: async (connection: { kind: string }, side: { objectType: string }) =>
    (connection.kind === "oracle"
      ? side.objectType === "sequence"
        ? sequences
        : []
      : side.objectType === "table"
        ? Object.keys(database)
        : []
    ).map((name) => ({ name, oid: null })),
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

test("Oracle discovery excludes actual identity sequences while retaining explicit managed objects and user sequences", async () => {
  const providers = useProvidersStore.getState();
  const provider = providers.providers[0];
  useProvidersStore.setState({
    loaded: true,
    providers: [
      { ...provider, kind: "oracle", capabilities: { ...provider.capabilities, sequences: true } },
    ],
  });
  const project: VersioningProject = {
    format: 1,
    id: "oracle",
    name: "Oracle",
    kind: "oracle",
    objects: [],
  };
  const connection = {
    id: "oracle",
    kind: "oracle",
    connectionString: "oracle://test@localhost/FREEPDB1",
  } as SavedConnection;
  const source = {
    connectionId: "oracle",
    database: null,
    schema: "app",
    objectType: "sequence" as const,
    objectName: null,
    objectOid: null,
  };
  for (const name of sequences) database[name] = `SEQUENCE app.${name}`;
  const scan = () => scanDrift("/r", project, connection, source, () => {});
  try {
    expect((await scan()).map((entry) => entry.object.selection.objectName)).toEqual([
      "ISEQ$$_USER",
      "APP_SEQUENCE",
    ]);
    project.objects = [
      {
        ...managed("ISEQ$$_123"),
        selection: { ...managed("ISEQ$$_123").selection, objectType: "sequence" },
      },
    ];
    expect((await scan()).find((entry) => entry.object.id === "ISEQ$$_123")?.status).toBe(
      "changed",
    );
  } finally {
    for (const name of sequences) delete database[name];
    useProvidersStore.setState(providers);
  }
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
  mock.module("../src/lib/db", () => db);
});
