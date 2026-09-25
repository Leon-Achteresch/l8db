import { describe, expect, test } from "bun:test";

import {
  buildColumnValueOptions,
  constraintDialectInfo,
  describeConstraint,
  emptyConstraint,
  foreignKeyIssues,
  parseCheckValues,
  parseEnumTypeValues,
  typeFamily,
} from "../src/lib/constraint-designer";
import type { DetailedColumnInfo, TableConstraintSpec } from "../src/lib/db";

type ForeignKey = Extract<TableConstraintSpec, { kind: "foreign_key" }>;

function fk(overrides: Partial<ForeignKey> = {}): ForeignKey {
  return {
    ...(emptyConstraint("foreign_key") as ForeignKey),
    columns: ["customer_id"],
    ref_schema: "public",
    ref_table: "customer",
    ref_columns: ["id"],
    ...overrides,
  };
}

function detailed(name: string, data_type: string): DetailedColumnInfo {
  return {
    name,
    data_type,
    is_nullable: true,
    column_default: null,
    is_primary_key: false,
    ordinal_position: 1,
    character_maximum_length: null,
  };
}

describe("constraint dialects", () => {
  test("hides unsupported options per dialect", () => {
    expect(constraintDialectInfo("mysql")?.deferrable).toBe(false);
    expect(constraintDialectInfo("mysql")?.deleteActions).not.toContain("SET DEFAULT");
    expect(constraintDialectInfo("mssql")?.deleteActions).not.toContain("RESTRICT");
    expect(constraintDialectInfo("oracle")?.updateActions).toEqual(["NO ACTION"]);
    expect(constraintDialectInfo("postgres")?.deferrable).toBe(true);
    expect(constraintDialectInfo("sqlite")?.alter).toBe(false);
    expect(constraintDialectInfo("sqlite")?.createNote).toContain("PRAGMA foreign_keys");
    expect(constraintDialectInfo("duckdb")?.deleteActions).toEqual(["NO ACTION"]);
    expect(constraintDialectInfo("clickhouse")).toBeNull();
  });
});

describe("foreign key validation", () => {
  const local = [
    { name: "customer_id", data_type: "bigint" },
    { name: "code", data_type: "varchar(10)" },
  ];

  test("accepts compatible numeric types", () => {
    expect(foreignKeyIssues(fk(), local, [{ name: "id", data_type: "integer" }])).toEqual([]);
  });

  test("reports count and type mismatches", () => {
    const issues = foreignKeyIssues(
      fk({ columns: ["customer_id", "code"], ref_columns: ["id"] }),
      local,
      [{ name: "id", data_type: "uuid" }],
    );
    expect(issues.some((issue) => issue.includes("2 lokal, 1 referenziert"))).toBe(true);
    expect(issues.some((issue) => issue.includes("Typen passen nicht"))).toBe(true);
  });

  test("reports unknown target column and deferred without deferrable", () => {
    const issues = foreignKeyIssues(fk({ initially_deferred: true }), local, [
      { name: "other", data_type: "int" },
    ]);
    expect(issues).toContain("INITIALLY DEFERRED setzt DEFERRABLE voraus.");
    expect(issues.some((issue) => issue.includes('"id" existiert'))).toBe(true);
  });

  test("groups types into families", () => {
    expect(typeFamily("character varying(20)")).toBe("text");
    expect(typeFamily("NVARCHAR(MAX)")).toBe("text");
    expect(typeFamily("int unsigned")).toBe("number");
    expect(typeFamily("NUMBER(10,0)")).toBe("number");
    expect(typeFamily("uniqueidentifier")).toBe("uuid");
    expect(typeFamily("integer[]")).toBeNull();
    expect(typeFamily("geometry")).toBeNull();
  });

  test("describes constraints for the list", () => {
    expect(describeConstraint(fk({ on_delete: "CASCADE", deferrable: true }))).toBe(
      "FOREIGN KEY (customer_id) → public.customer (id) ON DELETE CASCADE DEFERRABLE",
    );
  });
});

describe("check value lists", () => {
  test("parses postgres varchar ANY array", () => {
    expect(
      parseCheckValues(
        "CHECK (((a)::text = ANY ((ARRAY['x'::character varying, 'y'::character varying])::text[])))",
      ),
    ).toEqual({ column: "a", values: ["x", "y"] });
  });

  test("parses postgres text and numeric arrays", () => {
    expect(parseCheckValues("CHECK ((b = ANY (ARRAY['p'::text, 'it''s'::text])))")).toEqual({
      column: "b",
      values: ["p", "it's"],
    });
    expect(parseCheckValues("CHECK ((c = ANY (ARRAY[1, 2])))")).toEqual({
      column: "c",
      values: ["1", "2"],
    });
  });

  test("parses mysql, oracle and sql server forms", () => {
    expect(parseCheckValues("CHECK (`a` in (_latin1\\'x\\',_utf8mb4\\'y\\'))")).toEqual({
      column: "a",
      values: ["x", "y"],
    });
    expect(parseCheckValues(`"STATUS" IN ('NEW', 'DONE')`)).toEqual({
      column: "STATUS",
      values: ["NEW", "DONE"],
    });
    expect(parseCheckValues("([status]='b' OR [status]=N'a')")).toEqual({
      column: "status",
      values: ["b", "a"],
    });
  });

  test("ignores other checks", () => {
    expect(parseCheckValues("CHECK ((qty >= 0))")).toBeNull();
    expect(parseCheckValues("CHECK ((a = 'x' OR b = 'y'))")).toBeNull();
    expect(parseCheckValues(`"X" IS NOT NULL`)).toBeNull();
    expect(parseCheckValues("CHECK (a IN ('x', b))")).toBeNull();
  });

  test("parses mysql enum types", () => {
    expect(parseEnumTypeValues("enum('small','it''s big')")).toEqual(["small", "it's big"]);
    expect(parseEnumTypeValues("varchar(10)")).toBeNull();
  });

  test("combines enums, enum types and check lists per column", () => {
    const options = buildColumnValueOptions(
      [
        detailed("status", "USER-DEFINED"),
        detailed("size", "enum('s','m')"),
        detailed("Kind", "text"),
      ],
      [
        {
          name: "ck_kind",
          constraint_type: "CHECK",
          columns: ["Kind"],
          definition: "CHECK (kind IN ('a', 'b'))",
        },
      ],
      [{ column: "status", values: ["new", "done"] }],
    );
    expect(options).toEqual({ status: ["new", "done"], size: ["s", "m"], Kind: ["a", "b"] });
  });
});
