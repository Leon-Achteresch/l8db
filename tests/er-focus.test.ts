import { describe, expect, test } from "bun:test";

import type { ERSchema, ERTable, ForeignKeyInfo } from "../src/lib/db";
import {
  erFocusTableKeys,
  erTableKey,
  filterErSchema,
  parseErFocus,
  parseErFocusDepth,
} from "../src/lib/er-focus";

function table(schema: string, name: string): ERTable {
  return {
    schema,
    name,
    columns: [{ name: "id", data_type: "int", is_primary_key: true, is_nullable: false }],
  };
}

function fk(from: string, to: string, name?: string): ForeignKeyInfo {
  const [fromSchema, fromTable] = from.split(".");
  const [toSchema, toTable] = to.split(".");
  return {
    constraint_name: name ?? `${fromTable}_${toTable}_fkey`,
    from_schema: fromSchema,
    from_table: fromTable,
    from_column: "id",
    to_schema: toSchema,
    to_table: toTable,
    to_column: "id",
  };
}

const schema: ERSchema = {
  tables: [
    table("public", "orders"),
    table("public", "customers"),
    table("public", "order_items"),
    table("public", "products"),
    table("public", "unrelated"),
    table("sales", "orders"),
  ],
  foreign_keys: [
    fk("public.orders", "public.customers"),
    fk("public.order_items", "public.orders"),
    fk("public.order_items", "public.products"),
    fk("sales.orders", "public.customers", "sales_orders_customers_fkey"),
  ],
};

describe("erFocusTableKeys", () => {
  test("Tiefe 0 zeigt nur die Starttabelle", () => {
    expect(erFocusTableKeys(schema, { schema: "public", table: "orders", depth: 0 })).toEqual([
      "public.orders",
    ]);
  });

  test("Tiefe 1 enthält direkte FK-Nachbarn in beide Richtungen", () => {
    const keys = erFocusTableKeys(schema, { schema: "public", table: "orders", depth: 1 });
    expect(new Set(keys)).toEqual(
      new Set(["public.orders", "public.customers", "public.order_items"]),
    );
  });

  test("Tiefe 2 erweitert um die nächste Ebene", () => {
    const keys = erFocusTableKeys(schema, { schema: "public", table: "orders", depth: 2 });
    expect(new Set(keys)).toEqual(
      new Set([
        "public.orders",
        "public.customers",
        "public.order_items",
        "public.products",
        "sales.orders",
      ]),
    );
    expect(keys).not.toContain("public.unrelated");
  });

  test("Zyklen und Selbstreferenzen erzeugen keine doppelten Knoten", () => {
    const cyclic: ERSchema = {
      tables: [table("public", "a"), table("public", "b"), table("public", "c")],
      foreign_keys: [
        fk("public.a", "public.b", "ab"),
        fk("public.b", "public.c", "bc"),
        fk("public.c", "public.a", "ca"),
        fk("public.a", "public.a", "aa"),
      ],
    };
    const keys = erFocusTableKeys(cyclic, { schema: "public", table: "a", depth: 2 });
    expect(keys).toEqual([...new Set(keys)]);
    expect(new Set(keys)).toEqual(new Set(["public.a", "public.b", "public.c"]));
  });

  test("gleichnamige Tabellen in anderen Schemas bleiben getrennt", () => {
    const keys = erFocusTableKeys(schema, { schema: "sales", table: "orders", depth: 1 });
    expect(new Set(keys)).toEqual(new Set(["sales.orders", "public.customers"]));
  });

  test("unbekannte Fokustabelle liefert keine Knoten", () => {
    expect(erFocusTableKeys(schema, { schema: "public", table: "ghost", depth: 2 })).toEqual([]);
  });
});

describe("filterErSchema", () => {
  test("ohne Fokus bleibt das Schema unverändert", () => {
    expect(filterErSchema(schema, null)).toBe(schema);
  });

  test("Foreign Keys werden auf den Ausschnitt begrenzt", () => {
    const filtered = filterErSchema(schema, { schema: "public", table: "orders", depth: 1 });
    expect(filtered.tables.map((t) => erTableKey(t.schema, t.name))).toEqual([
      "public.orders",
      "public.customers",
      "public.order_items",
    ]);
    expect(filtered.foreign_keys.map((entry) => entry.constraint_name)).toEqual([
      "orders_customers_fkey",
      "order_items_orders_fkey",
    ]);
  });

  test("Tiefe 0 lässt keine Beziehungen übrig", () => {
    const filtered = filterErSchema(schema, { schema: "public", table: "orders", depth: 0 });
    expect(filtered.tables).toHaveLength(1);
    expect(filtered.foreign_keys).toHaveLength(0);
  });

  test("fehlende Fokustabelle ergibt einen leeren Ausschnitt", () => {
    const filtered = filterErSchema(schema, { schema: "public", table: "ghost", depth: 1 });
    expect(filtered).toEqual({ tables: [], foreign_keys: [] });
  });
});

describe("parseErFocus", () => {
  test("Tiefe wird auf 0 bis 2 begrenzt", () => {
    expect(parseErFocusDepth("0")).toBe(0);
    expect(parseErFocusDepth("2")).toBe(2);
    expect(parseErFocusDepth("7")).toBe(1);
    expect(parseErFocusDepth(undefined)).toBe(1);
  });

  test("unvollständige Angaben ergeben keinen Fokus", () => {
    expect(parseErFocus({ focusSchema: "public" })).toBeNull();
    expect(parseErFocus({ focusSchema: "public", focusTable: "orders", depth: 2 })).toEqual({
      schema: "public",
      table: "orders",
      depth: 2,
    });
  });
});
