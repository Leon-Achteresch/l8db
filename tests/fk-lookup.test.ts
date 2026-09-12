import { describe, expect, test } from "bun:test";

import type { ForeignKeyInfo } from "../src/lib/db";
import {
  buildFkSearchFilter,
  escapeLikePattern,
  fkLabelColumns,
  fkOptionLabel,
  fkOptionValue,
  fkPageOffset,
  hasMoreFkRows,
  isNullableColumn,
  outgoingForeignKey,
  quoteSqlIdentifier,
  resolveFkTarget,
} from "../src/lib/fk-lookup";

const fk: ForeignKeyInfo = {
  constraint_name: "orders_customer_id_fkey",
  from_schema: "public",
  from_table: "orders",
  from_column: "customer_id",
  to_schema: "public",
  to_table: "customers",
  to_column: "id",
};

describe("resolveFkTarget", () => {
  test("liefert die Referenztabelle für ausgehende Schlüssel", () => {
    expect(resolveFkTarget(fk, "public", "orders")).toEqual({
      schema: "public",
      table: "customers",
      keyColumn: "id",
    });
  });

  test("ignoriert eingehende Referenzen", () => {
    expect(resolveFkTarget(fk, "public", "customers")).toBeNull();
  });
});

describe("outgoingForeignKey", () => {
  test("findet den Schlüssel zur Spalte", () => {
    expect(outgoingForeignKey([fk], "public", "orders", "customer_id")).toEqual(fk);
    expect(outgoingForeignKey([fk], "public", "orders", "total")).toBeNull();
    expect(outgoingForeignKey(undefined, "public", "orders", "customer_id")).toBeNull();
  });
});

describe("fkLabelColumns", () => {
  test("bevorzugt sprechende Spalten und schließt Schlüssel/ctid aus", () => {
    expect(fkLabelColumns(["id", "__ctid__", "created_at", "name", "email"], "id")).toEqual([
      "name",
      "email",
      "created_at",
    ]);
  });

  test("begrenzt die Anzahl", () => {
    expect(fkLabelColumns(["id", "a", "b", "c", "d"], "id", 2)).toEqual(["a", "b"]);
  });
});

describe("buildFkSearchFilter", () => {
  test("liefert leeren Filter ohne Suchbegriff", () => {
    expect(buildFkSearchFilter("id", ["name"], "  ")).toBe("");
  });

  test("durchsucht Schlüssel- und Anzeigespalten", () => {
    expect(buildFkSearchFilter("id", ["name"], "ada")).toBe(
      `("id"::text ILIKE '%ada%' ESCAPE '!' OR "name"::text ILIKE '%ada%' ESCAPE '!')`,
    );
  });

  test("escaped Hochkommas und LIKE-Platzhalter", () => {
    const filter = buildFkSearchFilter("id", [], "50%_o'brien");
    expect(filter).toBe(`("id"::text ILIKE '%50!%!_o''brien%' ESCAPE '!')`);
  });

  test("dupliziert keine Spalte", () => {
    expect(buildFkSearchFilter("id", ["id", "name"], "x")).toBe(
      `("id"::text ILIKE '%x%' ESCAPE '!' OR "name"::text ILIKE '%x%' ESCAPE '!')`,
    );
  });
});

describe("quoteSqlIdentifier", () => {
  test("escaped doppelte Anführungszeichen", () => {
    expect(quoteSqlIdentifier('we"ird')).toBe('"we""ird"');
  });
});

describe("escapeLikePattern", () => {
  test("escaped Backslash, Prozent und Unterstrich", () => {
    expect(escapeLikePattern("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });
});

describe("Pagination", () => {
  test("berechnet Offset und erkennt weitere Seiten", () => {
    expect(fkPageOffset(0)).toBe(0);
    expect(fkPageOffset(2, 25)).toBe(50);
    expect(fkPageOffset(-1, 25)).toBe(0);
    expect(hasMoreFkRows(25, 25)).toBe(true);
    expect(hasMoreFkRows(24, 25)).toBe(false);
  });
});

describe("fkOptionValue / fkOptionLabel", () => {
  test("liefert den Schlüssel, nicht den Anzeigetext", () => {
    const row = { id: 42, name: "Ada", city: "Bonn" };
    expect(fkOptionValue(row, "id")).toBe("42");
    expect(fkOptionLabel(row, "id", ["name", "city"])).toBe("Ada · Bonn");
  });

  test("fällt auf den Schlüssel zurück, wenn keine Anzeigewerte da sind", () => {
    const row = { id: 1, name: null };
    expect(fkOptionLabel(row, "id", ["name"])).toBe("1");
    expect(fkOptionValue({ id: null }, "id")).toBeNull();
  });
});

describe("isNullableColumn", () => {
  test("erlaubt NULL nur bei nullable Spalten", () => {
    const columns = [
      { name: "customer_id", is_nullable: true },
      { name: "total", is_nullable: false },
    ];
    expect(isNullableColumn(columns, "customer_id")).toBe(true);
    expect(isNullableColumn(columns, "total")).toBe(false);
    expect(isNullableColumn(columns, "unbekannt")).toBe(false);
    expect(isNullableColumn(undefined, "customer_id")).toBe(false);
  });
});
