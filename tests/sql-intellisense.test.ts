import { describe, expect, it } from "bun:test";
import {
  hoverMarkdown,
  packageForQualifier,
  resolveSymbol,
  rowsMarkdownTable,
  type SqlObjectRegistry,
  suggestCompletions,
  tokenAt,
} from "@/lib/sql-intellisense";

const registry: SqlObjectRegistry = {
  schemas: ["HR", "public"],
  tables: [
    { schema: "HR", name: "EMPLOYEES" },
    { schema: "public", name: "orders" },
  ],
  views: [{ schema: "HR", name: "EMP_V" }],
  columns: [
    { schema: "HR", table: "EMPLOYEES", name: "EMP_ID", data_type: "NUMBER" },
    { schema: "HR", table: "EMPLOYEES", name: "NAME", data_type: "VARCHAR2" },
    { schema: "public", table: "orders", name: "id", data_type: "integer" },
  ],
  functions: [
    {
      schema: "HR",
      name: "PKG_EMP",
      identity_args: "",
      return_type: "PACKAGE",
      language: "PL/SQL",
      oid: "pkg",
    },
    {
      schema: "public",
      name: "calc_total",
      identity_args: "order_id integer",
      return_type: "numeric",
      language: "plpgsql",
      oid: "fn1",
    },
  ],
  procedures: [
    {
      schema: "HR",
      name: "PROC_A",
      identity_args: "",
      return_type: "PROCEDURE",
      language: "PL/SQL",
      oid: "proc1",
    },
  ],
};

describe("tokenAt", () => {
  it("finds word and qualifier", () => {
    const token = tokenAt("  x := pkg_emp.get_name(1);", 18);
    expect(token).toEqual({
      word: "get_name",
      qualifier: "pkg_emp",
      startColumn: 16,
      endColumn: 24,
    });
  });
  it("returns null outside identifiers", () => {
    expect(tokenAt("a  b", 3)).toBeNull();
  });
});

describe("resolveSymbol", () => {
  it("resolves package member", () => {
    const target = resolveSymbol(registry, tokenAt("pkg_emp.get_name", 10)!);
    expect(target).toEqual({ kind: "package", schema: "HR", name: "PKG_EMP", member: "GET_NAME" });
  });
  it("resolves schema-qualified objects and case-insensitive names", () => {
    expect(resolveSymbol(registry, tokenAt("hr.employees", 5)!)).toMatchObject({
      kind: "table",
      name: "EMPLOYEES",
      entityType: "table",
    });
    expect(resolveSymbol(registry, tokenAt("public.calc_total", 10)!)).toMatchObject({
      kind: "function",
      oid: "fn1",
    });
  });
  it("resolves alias columns to table with column", () => {
    const source = "SELECT e.name FROM hr.employees e";
    expect(
      resolveSymbol(registry, tokenAt("SELECT e.name FROM hr.employees e", 10)!, source),
    ).toEqual({
      kind: "table",
      schema: "HR",
      name: "EMPLOYEES",
      entityType: "table",
      column: "NAME",
    });
  });
  it("prefers local members in package bodies", () => {
    const source =
      "PACKAGE BODY x IS\n  PROCEDURE proc_a IS BEGIN NULL; END;\n  BEGIN proc_a; END;";
    expect(resolveSymbol(registry, tokenAt("  BEGIN proc_a; END;", 10)!, source)).toEqual({
      kind: "local",
      name: "PROC_A",
      line: 2,
      memberKind: "PROCEDURE",
    });
    expect(resolveSymbol(registry, tokenAt("proc_a", 2)!)).toMatchObject({ kind: "procedure" });
  });
});

describe("suggestCompletions", () => {
  it("lists objects of a schema after dot", () => {
    const labels = suggestCompletions(registry, "SELECT * FROM hr.", "SELECT * FROM hr.").map(
      (s) => s.label,
    );
    expect(labels).toEqual(["EMPLOYEES", "EMP_V", "PKG_EMP", "PROC_A"]);
  });
  it("lists columns after alias dot", () => {
    const text = "SELECT e. FROM employees e";
    const labels = suggestCompletions(registry, "SELECT e.", "SELECT e.").map((s) => s.label);
    expect(labels).toEqual([]);
    const withFrom = suggestCompletions(registry, text, "SELECT e.");
    expect(withFrom.map((s) => s.label)).toEqual(["EMP_ID", "NAME"]);
  });
  it("offers db routines with snippet args in general context", () => {
    const fn = suggestCompletions(registry, "SELECT ", "SELECT ").find(
      (s) => s.label === "calc_total",
    );
    expect(fn).toMatchObject({ kind: "function", insertText: "calc_total($0)", snippet: true });
  });
  it("detects package qualifier", () => {
    expect(packageForQualifier(registry, "  pkg_emp.ge")?.name).toBe("PKG_EMP");
    expect(packageForQualifier(registry, "  hr.")).toBeNull();
  });
});

describe("hover", () => {
  it("renders table preview with columns and rows", () => {
    const md = hoverMarkdown(
      registry,
      { kind: "table", schema: "HR", name: "EMPLOYEES", entityType: "table" },
      { rows: { columns: ["EMP_ID"], rows: [{ EMP_ID: "1|2" }] } },
    );
    expect(md).toContain("- `EMP_ID` NUMBER");
    expect(md).toContain("| 1\\|2 |");
  });
  it("escapes and truncates cells", () => {
    expect(rowsMarkdownTable(["a"], [{ a: "x".repeat(50) }])).toContain("…");
  });
});
