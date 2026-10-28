import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import {
  compareCatalogs,
  defaultSelection,
  markMissingTablespaces,
} from "../src/lib/schema-compare/diff";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import { type CompareResult, DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

const table = (name: string, tablespace: string): CatalogObject => ({
  object_type: "table",
  name,
  parent: null,
  ddl: `CREATE TABLE "APP"."${name}"\n(\n  "ID" NUMBER\n)`,
  attributes: { tablespace },
});

const index = (name: string, parent: string, tablespace: string): CatalogObject => ({
  object_type: "index",
  name,
  parent,
  ddl: `CREATE INDEX "APP"."${name}" ON "APP"."${parent}" ("ID")`,
  attributes: { definition: `ON "APP"."${parent}" ("ID")`, tablespace },
});

function result(
  source: CatalogObject[],
  target: CatalogObject[],
  ignoreTablespace: boolean,
): CompareResult {
  const context = {
    kind: "oracle" as const,
    sourceSchema: "APP",
    targetSchema: "APP",
    options: { ...DEFAULT_COMPARE_OPTIONS, ignoreTablespace },
  };
  return {
    ...context,
    source: { connectionId: null, database: null, schema: "APP" },
    target: { connectionId: "ora", database: null, schema: "APP" },
    sourceLabel: "Quelle",
    targetLabel: "Ziel",
    types: ["table", "index"],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

describe("Tablespace-Prüfung", () => {
  test("wählt Unterschiede ab, die einen fehlenden Tablespace brauchen", () => {
    const compare = result(
      [
        table("NEU", "DATA"),
        table("OK", "USERS"),
        table("ALT", "USERS"),
        index("ALT_I", "ALT", "IDX"),
      ],
      [table("ALT", "USERS"), index("ALT_I", "ALT", "USERS")],
      false,
    );
    markMissingTablespaces(compare.items, new Set(["USERS"]));
    const byName = Object.fromEntries(compare.items.map((item) => [item.name, item]));
    expect(byName.NEU.blocked).toBe("Tablespace DATA fehlt im Ziel oder ist dort nicht nutzbar");
    expect(byName.ALT_I.blocked).toContain("Tablespace IDX");
    expect(byName.OK.blocked).toBeUndefined();
    expect(Object.keys(defaultSelection(compare.items))).toEqual(["table||OK"]);
  });

  test("prüft auch Indizes neuer Tabellen", () => {
    const compare = result([table("NEU", "USERS"), index("NEU_I", "NEU", "IDX")], [], false);
    markMissingTablespaces(compare.items, new Set(["USERS"]));
    expect(compare.items[0].blocked).toContain("IDX");
  });

  test("legt Tabellen und Indizes nur ohne Tablespace-Ignorieren im Quell-Tablespace an", () => {
    const source = [table("NEU", "DATA"), index("NEU_I", "NEU", "IDX")];
    const kept = result(source, [], false);
    const sql = buildSyncScript(kept, defaultSelection(kept.items)).statements.map(
      (statement) => statement.sql,
    );
    expect(sql).toEqual([
      `CREATE TABLE "APP"."NEU"\n(\n  "ID" NUMBER\n) TABLESPACE "DATA"`,
      `CREATE INDEX "APP"."NEU_I" ON "APP"."NEU" ("ID") TABLESPACE "IDX"`,
    ]);
    const ignored = result(source, [], true);
    expect(
      buildSyncScript(ignored, defaultSelection(ignored.items)).statements.map(
        (statement) => statement.sql,
      ),
    ).toEqual([
      `CREATE TABLE "APP"."NEU"\n(\n  "ID" NUMBER\n)`,
      `CREATE INDEX "APP"."NEU_I" ON "APP"."NEU" ("ID")`,
    ]);
  });
});
