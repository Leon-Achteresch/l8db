import { describe, expect, test } from "bun:test";
import {
  columnEditSupport,
  defaultDataType,
  dropColumnDescription,
  getDataTypeGroups,
  isListedDataType,
  nullableLocked,
} from "../src/features/alter-table/alter-table-view/data-types";
import { columnTypeLabel } from "../src/lib/column-type";

describe("alter table data types", () => {
  test("offers dialect specific types and defaults", () => {
    const listed = (kind: Parameters<typeof getDataTypeGroups>[0]) =>
      getDataTypeGroups(kind).flatMap((group) => group.types);
    expect(listed("oracle")).toContain("VARCHAR2(255)");
    expect(listed("oracle")).not.toContain("jsonb");
    expect(listed("mysql")).not.toContain("timestamp with time zone");
    expect(listed("mssql")).toContain("nvarchar(max)");
    expect(listed("cassandra")).toContain("timeuuid");
    expect(defaultDataType("oracle")).toBe("VARCHAR2(255)");
    expect(defaultDataType("mysql")).toBe("varchar(255)");
    expect(defaultDataType("postgres")).toBe("text");
  });

  test("matches listed types case-insensitively", () => {
    const groups = getDataTypeGroups("clickhouse");
    expect(isListedDataType(groups, "UInt8")).toBe(true);
    expect(isListedDataType(groups, "uint8")).toBe(true);
    expect(isListedDataType(groups, "Enum8('a' = 1)")).toBe(false);
  });
});

describe("column type label", () => {
  test("does not repeat lengths already part of the type", () => {
    expect(columnTypeLabel("varchar(20)", 20)).toBe("varchar(20)");
    expect(columnTypeLabel("VARCHAR2(50)", 50)).toBe("VARCHAR2(50)");
    expect(columnTypeLabel("text", 65535)).toBe("text");
    expect(columnTypeLabel("nvarchar", -1)).toBe("nvarchar(max)");
    expect(columnTypeLabel("character varying", 40)).toBe("character varying(40)");
    expect(columnTypeLabel("integer", null)).toBe("integer");
  });
});

describe("column edit support", () => {
  test("limits edits to what each dialect can apply", () => {
    expect(columnEditSupport("sqlite").renameOnly).toBe(true);
    expect(columnEditSupport("cassandra")).toMatchObject({
      renameOnly: true,
      addConstraints: false,
    });
    expect(columnEditSupport("postgres")).toMatchObject({
      renameOnly: false,
      using: true,
      dropCascade: true,
    });
    expect(columnEditSupport("mysql").dropCascade).toBe(false);
    expect(dropColumnDescription("mysql")).not.toContain("CASCADE");
  });

  test("locks nullable for ClickHouse composite types only", () => {
    expect(nullableLocked("clickhouse", "Array(String)")).toBe(true);
    expect(nullableLocked("clickhouse", "Map(String, String)")).toBe(true);
    expect(nullableLocked("clickhouse", "LowCardinality(String)")).toBe(false);
    expect(nullableLocked("clickhouse", "String")).toBe(false);
    expect(nullableLocked("postgres", "Array(String)")).toBe(false);
  });
});
