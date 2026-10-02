import { expect, test } from "bun:test";

const { xlsxFullExportSupported } = await import("../src/features/export/xlsx-full-export");

const KINDS = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
  "elasticsearch",
  "influxdb",
  "sqlite_http",
  "dynamodb",
  "athena",
  "bigquery",
  "snowflake",
  "s3",
] as const;

test("full XLSX export is offered only where the backend can read a table snapshot", () => {
  for (const kind of KINDS) expect(xlsxFullExportSupported(kind)).toBe(kind === "postgres");
  expect(xlsxFullExportSupported(null)).toBe(false);
  expect(xlsxFullExportSupported(undefined)).toBe(false);
});
