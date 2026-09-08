import { describe, expect, it } from "vitest";
import { buildViewDdl } from "@/lib/query-builder";

describe("buildViewDdl", () => {
  it("uses CREATE OR REPLACE for postgres", () => {
    expect(buildViewDdl("postgres", "public", "v", "SELECT 1;")).toBe(
      'CREATE OR REPLACE VIEW "public"."v" AS\nSELECT 1;',
    );
  });

  it("uses CREATE OR ALTER for mssql", () => {
    expect(buildViewDdl("mssql", "dbo", "v", "SELECT 1")).toBe(
      "CREATE OR ALTER VIEW [dbo].[v] AS\nSELECT 1;",
    );
  });

  it("drops first on sqlite", () => {
    expect(buildViewDdl("sqlite", "", "v", "SELECT 1")).toBe(
      'DROP VIEW IF EXISTS "v";\nCREATE VIEW "v" AS\nSELECT 1;',
    );
  });
});
