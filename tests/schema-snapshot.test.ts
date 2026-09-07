import { describe, expect, test } from "bun:test";

import type { DetailedColumnInfo } from "../src/lib/db";
import {
  buildSnapshot,
  buildSnapshotTable,
  diffSnapshots,
  parseSnapshot,
  SCHEMA_SNAPSHOT_VERSION,
  type SchemaSnapshot,
  serializeSnapshot,
  snapshotFileName,
} from "../src/lib/schema-snapshot";

function column(overrides: Partial<DetailedColumnInfo> = {}): DetailedColumnInfo {
  return {
    name: "id",
    data_type: "integer",
    is_nullable: false,
    column_default: null,
    is_primary_key: true,
    ordinal_position: 1,
    character_maximum_length: null,
    ...overrides,
  };
}

const scope = {
  connection_name: "Lokal",
  kind: "postgres",
  database: "app",
  schema: "public",
  requested_tables: ["users", "orders"],
};

function snapshotWith(columns: DetailedColumnInfo[]): SchemaSnapshot {
  return buildSnapshot(scope, [buildSnapshotTable("public", "users", columns)], new Date(0));
}

describe("buildSnapshot", () => {
  test("enthält Version, Zeitstempel und expliziten Umfang", () => {
    const snapshot = snapshotWith([column()]);
    expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
    expect(snapshot.captured_at).toBe("1970-01-01T00:00:00.000Z");
    expect(snapshot.scope.requested_tables).toEqual(["orders", "users"]);
    expect(snapshot.scope.schema).toBe("public");
    expect(snapshot.complete).toBe(true);
  });

  test("sortiert Spalten nach Position und leitet Primärschlüssel ab", () => {
    const snapshot = snapshotWith([
      column({ name: "email", ordinal_position: 2, is_primary_key: false, data_type: "text" }),
      column(),
    ]);
    expect(snapshot.tables[0].columns.map((c) => c.name)).toEqual(["id", "email"]);
    expect(snapshot.tables[0].primary_key).toEqual(["id"]);
  });

  test("markiert unvollständige Erfassung", () => {
    const snapshot = buildSnapshot(
      scope,
      [buildSnapshotTable("public", "users", [], "keine Berechtigung")],
      new Date(0),
    );
    expect(snapshot.complete).toBe(false);
    expect(snapshot.tables[0].incomplete_reason).toBe("keine Berechtigung");
  });
});

describe("serializeSnapshot", () => {
  test("enthält keine Zeilendaten und keine Verbindungsgeheimnisse", () => {
    const text = serializeSnapshot(snapshotWith([column()]));
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain("password");
    expect(text).not.toContain("rows");
    expect(JSON.parse(text).scope.connection_name).toBe("Lokal");
  });

  test("Datei-Name enthält Schema und Zeitstempel", () => {
    expect(snapshotFileName("public", "1970-01-01T00:00:00.000Z")).toBe(
      "snapshot-public-1970-01-01T00-00-00-000.json",
    );
  });
});

describe("parseSnapshot", () => {
  test("liest eigene Ausgabe wieder ein", () => {
    const snapshot = snapshotWith([column()]);
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
  });

  test("lehnt ungültiges JSON und fremde Versionen ab", () => {
    expect(() => parseSnapshot("{")).toThrow("kein gültiges JSON");
    expect(() => parseSnapshot(JSON.stringify({ version: 99 }))).toThrow("Snapshot-Version");
    expect(() => parseSnapshot(JSON.stringify({ version: SCHEMA_SNAPSHOT_VERSION }))).toThrow(
      "unvollständig",
    );
  });

  test("lehnt ungültige Tabelleneinträge ab", () => {
    const valid = JSON.parse(serializeSnapshot(snapshotWith([column()])));
    for (const broken of [null, "users", { schema: "public", name: "users" }, { ...valid.tables[0], primary_key: "id" }]) {
      expect(() => parseSnapshot(JSON.stringify({ ...valid, tables: [broken] }))).toThrow(
        "ungültige Tabelle",
      );
    }
  });
});

describe("diffSnapshots", () => {
  test("meldet keine Unterschiede bei gleichem Stand", () => {
    const snapshot = snapshotWith([column()]);
    expect(diffSnapshots(snapshot, snapshot)).toEqual([]);
  });

  test("erkennt neue, entfernte und geänderte Spalten", () => {
    const base = snapshotWith([
      column(),
      column({ name: "email", ordinal_position: 2, is_primary_key: false, data_type: "text" }),
    ]);
    const current = snapshotWith([
      column(),
      column({
        name: "note",
        ordinal_position: 2,
        is_primary_key: false,
        data_type: "varchar",
        character_maximum_length: 50,
        is_nullable: true,
      }),
    ]);
    const diff = diffSnapshots(base, current);
    const kinds = diff.map((entry) => `${entry.kind}:${entry.column}`);
    expect(kinds).toContain("column_removed:email");
    expect(kinds).toContain("column_added:note");
    expect(diff.every((entry) => entry.table === "public.users")).toBe(true);
  });

  test("erkennt Typ-, Nullbarkeits- und Primärschlüsseländerungen", () => {
    const base = snapshotWith([column()]);
    const current = snapshotWith([
      column({ data_type: "bigint", is_nullable: true, is_primary_key: false }),
    ]);
    const diff = diffSnapshots(base, current);
    const changed = diff.find((entry) => entry.kind === "column_changed");
    expect(changed?.detail).toBe("Geändert: Datentyp, Nullbarkeit");
    expect(changed?.before).toBe("integer NOT NULL");
    expect(changed?.after).toBe("bigint NULL");
    const pk = diff.find((entry) => entry.kind === "primary_key_changed");
    expect(pk?.before).toBe("id");
    expect(pk?.after).toBe("kein Primärschlüssel");
  });

  test("erkennt hinzugefügte und entfernte Tabellen", () => {
    const base = buildSnapshot(
      scope,
      [buildSnapshotTable("public", "users", [column()])],
      new Date(0),
    );
    const current = buildSnapshot(
      scope,
      [buildSnapshotTable("public", "orders", [column()])],
      new Date(0),
    );
    const diff = diffSnapshots(base, current);
    expect(diff.map((entry) => `${entry.kind}:${entry.table}`)).toEqual([
      "table_added:public.orders",
      "table_removed:public.users",
    ]);
  });
});
