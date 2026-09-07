import { describe, expect, test } from "bun:test";

import {
  buildMigrationScript,
  columnTypeSql,
  migrationFileName,
  migrationTransactional,
} from "../src/lib/migration-script";
import {
  diffSnapshots,
  type SchemaSnapshot,
  type SnapshotColumn,
  type SnapshotTable,
} from "../src/lib/schema-snapshot";

function column(overrides: Partial<SnapshotColumn> = {}): SnapshotColumn {
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

function table(name: string, columns: SnapshotColumn[], primaryKey: string[] = []): SnapshotTable {
  return {
    schema: "public",
    name,
    columns,
    primary_key: primaryKey,
    incomplete_reason: null,
  };
}

function snapshot(
  tables: SnapshotTable[],
  capturedAt = "2026-01-01T00:00:00.000Z",
): SchemaSnapshot {
  return {
    version: 1,
    captured_at: capturedAt,
    scope: {
      connection_name: "local",
      kind: "postgres",
      database: "app",
      schema: "public",
      requested_tables: tables.map((item) => item.name),
    },
    complete: tables.every((item) => item.incomplete_reason === null),
    tables,
  };
}

function build(base: SchemaSnapshot, current: SchemaSnapshot, includeDangerous = true) {
  return buildMigrationScript({
    kind: "postgres",
    base,
    current,
    entries: diffSnapshots(base, current),
    includeDangerous,
    generatedAt: new Date("2026-02-01T12:00:00.000Z"),
  });
}

describe("buildMigrationScript", () => {
  test("erzeugt CREATE TABLE für neue Tabellen mit Primärschlüssel", () => {
    const base = snapshot([]);
    const current = snapshot([
      table(
        "kunde",
        [
          column(),
          column({
            name: "name",
            data_type: "character varying",
            character_maximum_length: 80,
            is_nullable: true,
            is_primary_key: false,
            ordinal_position: 2,
          }),
        ],
        ["id"],
      ),
    ]);
    const script = build(base, current);
    expect(script.statements).toHaveLength(1);
    expect(script.statements[0].kind).toBe("create_table");
    expect(script.statements[0].sql).toContain('CREATE TABLE "public"."kunde"');
    expect(script.statements[0].sql).toContain('"name" character varying(80)');
    expect(script.statements[0].sql).toContain('PRIMARY KEY ("id")');
    expect(script.dangerousCount).toBe(0);
  });

  test("ordnet Anlegen vor Ändern vor Entfernen", () => {
    const base = snapshot([
      table("alt", [column()], ["id"]),
      table(
        "bestand",
        [column(), column({ name: "weg", is_primary_key: false, ordinal_position: 2 })],
        ["id"],
      ),
    ]);
    const current = snapshot([
      table(
        "bestand",
        [
          column(),
          column({ name: "neu", is_primary_key: false, ordinal_position: 2, is_nullable: true }),
        ],
        ["id"],
      ),
      table("neu_tab", [column()], ["id"]),
    ]);
    const script = build(base, current);
    expect(script.statements.map((item) => item.kind)).toEqual([
      "create_table",
      "add_column",
      "drop_column",
      "drop_table",
    ]);
  });

  test("markiert entfernende Anweisungen als gefährlich und kann sie auslassen", () => {
    const base = snapshot([
      table(
        "t",
        [column(), column({ name: "weg", is_primary_key: false, ordinal_position: 2 })],
        ["id"],
      ),
    ]);
    const current = snapshot([table("t", [column()], ["id"])]);
    const withDanger = build(base, current);
    expect(withDanger.dangerousCount).toBe(1);
    expect(withDanger.sql).toContain("ACHTUNG (gefährlich)");

    const without = build(base, current, false);
    expect(without.statements).toHaveLength(0);
    expect(without.skippedDangerous).toBe(1);
    expect(without.sql).toContain("ausgelassen");
  });

  test("zerlegt Spaltenänderungen in Typ, Vorgabewert und Nullbarkeit", () => {
    const base = snapshot([
      table("t", [
        column({ name: "wert", is_primary_key: false, is_nullable: true, data_type: "integer" }),
      ]),
    ]);
    const current = snapshot([
      table("t", [
        column({
          name: "wert",
          is_primary_key: false,
          is_nullable: false,
          data_type: "bigint",
          column_default: "0",
        }),
      ]),
    ]);
    const script = build(base, current);
    const sql = script.statements.map((item) => item.sql);
    expect(sql).toContain('ALTER TABLE "public"."t" ALTER COLUMN "wert" TYPE bigint;');
    expect(sql).toContain('ALTER TABLE "public"."t" ALTER COLUMN "wert" SET DEFAULT 0;');
    expect(sql).toContain('ALTER TABLE "public"."t" ALTER COLUMN "wert" SET NOT NULL;');
    expect(script.dangerousCount).toBe(2);
  });

  test("meldet nicht abbildbare Primärschlüsselwechsel", () => {
    const base = snapshot([table("t", [column()], ["id"])]);
    const current = snapshot([table("t", [column()], [])]);
    const script = build(base, current);
    expect(script.statements).toHaveLength(0);
    expect(script.issues).toHaveLength(1);
    expect(script.issues[0].detail).toContain("Primärschlüsselwechsel");
    expect(script.sql).toContain("Nicht abbildbare Unterschiede");
  });

  test("meldet unvollständige Metadaten", () => {
    const broken = { ...table("t", []), incomplete_reason: "keine Berechtigung" };
    const script = build(snapshot([]), snapshot([broken]));
    expect(script.issues.some((issue) => issue.detail.includes("keine Berechtigung"))).toBe(true);
  });

  test("klammert transaktional und ist reproduzierbar", () => {
    const base = snapshot([]);
    const current = snapshot([table("t", [column()], ["id"])]);
    const first = build(base, current);
    const second = build(base, current);
    expect(first.sql).toBe(second.sql);
    expect(first.transactional).toBe(true);
    expect(first.sql).toContain("BEGIN;");
    expect(first.sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  test("lässt die Transaktionsklammer bei nicht transaktionalem DDL weg", () => {
    const script = buildMigrationScript({
      kind: "mysql",
      base: snapshot([]),
      current: snapshot([table("t", [column()], ["id"])]),
      entries: diffSnapshots(snapshot([]), snapshot([table("t", [column()], ["id"])])),
    });
    expect(script.transactional).toBe(false);
    expect(script.sql).not.toContain("BEGIN;");
    expect(script.statements[0].sql).toContain("`public`.`t`");
  });
});

describe("Hilfsfunktionen", () => {
  test("columnTypeSql hängt Länge nur einmal an", () => {
    expect(columnTypeSql(column({ data_type: "varchar", character_maximum_length: 10 }))).toBe(
      "varchar(10)",
    );
    expect(columnTypeSql(column({ data_type: "varchar(10)", character_maximum_length: 10 }))).toBe(
      "varchar(10)",
    );
  });

  test("migrationTransactional kennt die Dialekte", () => {
    expect(migrationTransactional("postgres")).toBe(true);
    expect(migrationTransactional("oracle")).toBe(false);
    expect(migrationTransactional(null)).toBe(false);
  });

  test("migrationFileName bereinigt Schema und Zeitstempel", () => {
    expect(migrationFileName("public", "2026-02-01T12:00:00.000Z")).toBe(
      "migration-public-2026-02-01T12-00-00-000.sql",
    );
  });
});
