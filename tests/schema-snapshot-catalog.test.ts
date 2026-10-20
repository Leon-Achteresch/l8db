import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { SavedConnection } from "../src/lib/connections";
import type { CatalogObject } from "../src/lib/db";

const calls: { command: string; args: Record<string, unknown> }[] = [];
const files = new Map<string, string>();
let catalog: (schema: string) => CatalogObject[] = () => [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "schema_catalog")
      return catalog(String(args.schema)).filter(
        (object) =>
          (args.types as string[]).includes(object.object_type) || object.object_type === "column",
      );
    if (command === "schema_partition_ddl") return { ORDERS: "PARTITION BY RANGE (ID)" };
    return undefined;
  },
}));

mock.module("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { useProvidersStore } = await import("../src/lib/providers");
const { captureCatalogSnapshot, runSchemaCompare, setupProblem, useSchemaCompareStore } =
  await import("../src/lib/schema-compare/store");
const {
  buildCatalogSnapshot,
  buildSnapshot,
  buildSnapshotTable,
  parseCatalogSnapshot,
  serializeSnapshot,
} = await import("../src/lib/schema-snapshot");

const ORA: SavedConnection = {
  id: "ora",
  name: "ORA",
  kind: "oracle",
  connectionString: "oracle://u:p@127.0.0.1:1521/FREEPDB1",
  sslMode: "disable",
};

function table(schema: string, name: string, columns: [string, string][]): CatalogObject[] {
  return [
    {
      object_type: "table",
      name,
      parent: null,
      ddl: `CREATE TABLE "${schema}"."${name}"\n(\n  ${columns.map(([column, type]) => `"${column}" ${type}`).join(",\n  ")}\n)`,
      attributes: {},
    },
    ...columns.map(([column, type]) => ({
      object_type: "column" as const,
      name: column,
      parent: name,
      ddl: `"${column}" ${type}`,
      attributes: { type, nullable: "YES" },
    })),
  ];
}

const index = (schema: string, name: string, parent: string): CatalogObject => ({
  object_type: "index",
  name,
  parent,
  ddl: `CREATE INDEX "${schema}"."${name}" ON "${schema}"."${parent}" ("ID")`,
  attributes: { definition: `("ID")` },
});

function snapshotFile(path: string, schema: string, objects: CatalogObject[], types = ["table"]) {
  const snapshot = buildCatalogSnapshot(
    {
      kind: "oracle",
      connection_name: "Prod",
      database: null,
      schema,
      types: types as never,
    },
    objects,
    new Date("2026-10-01T10:00:00Z"),
  );
  files.set(path, serializeSnapshot(snapshot));
  return {
    connectionId: null,
    database: null,
    schema,
    snapshot: {
      path,
      kind: "oracle" as const,
      createdAt: snapshot.created_at,
      connectionName: "Prod",
    },
  };
}

beforeAll(() => useProvidersStore.setState({ loaded: true }));
afterAll(() => useProvidersStore.setState({ loaded: false }));

beforeEach(() => {
  calls.length = 0;
  files.clear();
  useConnectionsStore.setState({ connections: [ORA] });
  useSchemaCompareStore.setState({ result: null, error: null, loading: null, types: null });
});

describe("Katalog-Snapshot", () => {
  test("speichert alle Katalogobjekte und liest sie unverändert zurück", () => {
    const objects = [
      ...table("APP", "KUNDE", [["ID", "NUMBER"]]),
      index("APP", "KUNDE_I", "KUNDE"),
    ];
    const snapshot = buildCatalogSnapshot(
      {
        kind: "oracle",
        connection_name: "Prod",
        database: null,
        schema: "APP",
        types: ["table", "index"],
      },
      objects,
      new Date("2026-10-01T10:00:00Z"),
    );
    const parsed = parseCatalogSnapshot(serializeSnapshot(snapshot));
    expect(parsed).toEqual(snapshot);
    expect(parsed.version).toBe(2);
    expect(parsed.created_at).toBe("2026-10-01T10:00:00.000Z");
  });

  test("weist kaputte oder fremde Dateien verständlich ab", () => {
    expect(() => parseCatalogSnapshot("{")).toThrow("kein gültiges JSON");
    expect(() => parseCatalogSnapshot(JSON.stringify({ version: 7 }))).toThrow(
      "Snapshot-Version 7",
    );
    const base = { version: 2, kind: "oracle", schema: "APP", created_at: "x", types: ["table"] };
    expect(() =>
      parseCatalogSnapshot(JSON.stringify({ ...base, kind: "redis", objects: [] })),
    ).toThrow("redis");
    expect(() =>
      parseCatalogSnapshot(
        JSON.stringify({
          ...base,
          objects: [{ object_type: "virus", name: "x", parent: null, ddl: "", attributes: {} }],
        }),
      ),
    ).toThrow("ungültiges Objekt");
    expect(() =>
      parseCatalogSnapshot(
        JSON.stringify({
          ...base,
          objects: [
            { object_type: "table", name: "x", parent: null, ddl: "", attributes: { a: 1 } },
          ],
        }),
      ),
    ).toThrow("ungültiges Objekt");
  });

  test("wandelt alte Tabellen-Snapshots (Version 1) in Katalogobjekte um", () => {
    const legacy = buildSnapshot(
      {
        connection_name: "Lokal",
        kind: "postgres",
        database: "app",
        schema: "public",
        requested_tables: ["users"],
      },
      [
        buildSnapshotTable("public", "users", [
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
            name: "mail",
            data_type: "character varying",
            is_nullable: true,
            column_default: "'x'::character varying",
            is_primary_key: false,
            ordinal_position: 2,
            character_maximum_length: 80,
          },
        ] as never),
      ],
    );
    const parsed = parseCatalogSnapshot(serializeSnapshot(legacy));
    expect(parsed.kind).toBe("postgres");
    expect(parsed.types).toEqual(["table"]);
    expect(parsed.objects.map((object) => [object.object_type, object.name])).toEqual([
      ["table", "users"],
      ["column", "id"],
      ["column", "mail"],
    ]);
    expect(parsed.objects[2].attributes).toEqual({
      type: "character varying(80)",
      nullable: "YES",
      default: "'x'::character varying",
    });
    expect(parsed.objects[0].ddl).toContain(`CREATE TABLE "public"."users"`);
  });
});

describe("Snapshot als Vergleichsseite", () => {
  test("vergleicht eine Live-Verbindung mit einer Snapshot-Datei", async () => {
    catalog = (schema) => [
      ...table(schema, "KUNDE", [
        ["ID", "NUMBER"],
        ["NAME", "VARCHAR2(80 BYTE)"],
      ]),
      index(schema, "KUNDE_I", "KUNDE"),
    ];
    const target = snapshotFile("/tmp/prod.json", "PROD", [
      ...table("PROD", "KUNDE", [["ID", "NUMBER"]]),
      ...table("PROD", "ALT", [["ID", "NUMBER"]]),
    ]);
    useSchemaCompareStore.setState({ types: ["table", "index"] });
    await runSchemaCompare({
      source: { connectionId: "ora", database: null, schema: "DEV" },
      target,
    });
    const state = useSchemaCompareStore.getState();
    expect(state.error).toBeNull();
    expect(state.result?.types).toEqual(["table"]);
    expect(state.result?.targetSchema).toBe("PROD");
    expect(state.result?.targetLabel).toBe("Snapshot prod.json · PROD");
    expect(
      state.result?.items
        .filter((item) => item.status !== "identical")
        .map((item) => [item.type, item.name, item.status]),
    ).toEqual([
      ["table", "ALT", "only_target"],
      ["column", "NAME", "only_source"],
    ]);
    const requested = calls.find((call) => call.command === "schema_catalog");
    expect(requested?.args.types).toEqual(["table"]);
  });

  test("vergleicht zwei Snapshot-Dateien ohne Datenbankzugriff", async () => {
    const source = snapshotFile("/tmp/a.json", "A", table("A", "T", [["ID", "NUMBER(10)"]]));
    const target = snapshotFile("/tmp/b.json", "B", table("B", "T", [["ID", "NUMBER"]]));
    expect(setupProblem(source, target, ["table"])).toBeNull();
    useSchemaCompareStore.setState({ types: ["table"] });
    await runSchemaCompare({ source, target });
    const state = useSchemaCompareStore.getState();
    expect(state.error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(state.result?.items.find((item) => item.type === "column")?.differsBy).toEqual([
      "Datentyp",
    ]);
  });

  test("meldet unterschiedliche Datenbankarten", async () => {
    const source = snapshotFile("/tmp/a.json", "A", []);
    files.set("/tmp/pg.json", files.get("/tmp/a.json")?.replace('"oracle"', '"postgres"') ?? "");
    await runSchemaCompare({
      source,
      target: { ...source, snapshot: { ...source.snapshot, path: "/tmp/pg.json" } },
    });
    expect(useSchemaCompareStore.getState().error).toContain("dieselbe Datenbankart");
  });

  test("liest für einen Snapshot alle Objekttypen samt Partitionierung", async () => {
    catalog = (schema) => [
      {
        object_type: "table",
        name: "ORDERS",
        parent: null,
        ddl: `CREATE TABLE "${schema}"."ORDERS" ("ID" NUMBER)`,
        attributes: { partitioned: "YES" },
      },
    ];
    const snapshot = await captureCatalogSnapshot({
      connectionId: "ora",
      database: null,
      schema: "APP",
    });
    expect(snapshot.kind).toBe("oracle");
    expect(snapshot.connection_name).toBe("ORA");
    expect(snapshot.types).toContain("package_body");
    expect(snapshot.types).toContain("grant");
    expect(snapshot.objects[0].ddl).toContain("PARTITION BY RANGE (ID)");
    expect(calls.map((call) => call.command)).toEqual(["schema_catalog", "schema_partition_ddl"]);
  });
});
