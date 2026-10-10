import { expect, test } from "bun:test";
import { templateSql } from "../src/lib/sql-templates";

const columns = [{ name: "id", is_primary_key: true }, { name: "email" }, { name: "full name" }];

test("baut SELECT, INSERT und Spaltenliste mit Bind-Parametern", () => {
  expect(templateSql("select", "public", "customers", columns, "postgres")).toBe(
    'SELECT "id", "email", "full name"\nFROM "public"."customers";',
  );
  expect(templateSql("select", "", "t", [], "mysql")).toBe("SELECT *\nFROM `t`;");
  expect(templateSql("insert", "dbo", "customers", columns, "mssql")).toBe(
    "INSERT INTO [dbo].[customers] ([id], [email], [full name])\nVALUES (:id, :email, :full_name);",
  );
  expect(templateSql("columns", "public", "customers", columns, "postgres")).toBe(
    '"id", "email", "full name"',
  );
});

test("UPDATE nutzt Primärschlüssel im WHERE und lässt ihn sonst offen", () => {
  expect(templateSql("update", "public", "customers", columns, "postgres")).toBe(
    'UPDATE "public"."customers"\nSET "email" = :email,\n    "full name" = :full_name\nWHERE "id" = :id;',
  );
  expect(templateSql("update", "public", "log", [{ name: "1st" }], "postgres")).toBe(
    'UPDATE "public"."log"\nSET "1st" = :_1st\nWHERE /* Bedingung */;',
  );
});
