import { expect, test } from "bun:test";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";
import { columnFilterCounts } from "../src/features/table/table-columns-list/column-type-config";

const sortKey = (name: string, data_type: string) =>
  ({
    name,
    data_type,
    is_nullable: false,
    is_primary_key: true,
    column_default: null,
    ordinal_position: 1,
    character_maximum_length: null,
    comment: null,
  }) as never;

test("ClickHouse-Sortierschlüssel zeigen im Kopf den Typ statt id", () => {
  expect(getColumnTypeInfo("ts", [], sortKey("ts", "DateTime64(3, 'UTC')")).label).toBe(
    "timestamp",
  );
  expect(getColumnTypeInfo("tags", [], sortKey("tags", "Array(String)")).label).toBe("json");
  expect(getColumnTypeInfo("id", [], sortKey("id", "UInt64")).kind).toBe("key");
});

test("der Schlüsselfilter trägt den Begriff der Familie", () => {
  const columns = [sortKey("kind", "LowCardinality(String)"), sortKey("id", "UInt64")];
  const pk = columnFilterCounts(columns, true, "Sortierschlüssel").find((f) => f.id === "pk");
  expect(pk).toMatchObject({ label: "Sortierschlüssel", count: 2 });
  expect(columnFilterCounts(columns).find((f) => f.id === "pk")?.label).toBe("Primärschlüssel");
});
