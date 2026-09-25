import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSyncScript } from "../src/lib/data-compare";
import { compareTableDataRemote, type DatabaseKind, executeQuery } from "../src/lib/db";
import { splitSqlStatements } from "../src/lib/sql-statements";

const BRIDGE = process.env.L8DB_SCHEMA_COMPARE_LIVE;
const MYSQL_URL = process.env.L8DB_SC_MYSQL_URL;
const MSSQL_URL = process.env.L8DB_SC_MSSQL_URL;
const TIMEOUT = 120_000;
const SQLITE_DIR = BRIDGE ? mkdtempSync(join(tmpdir(), "l8db-dc-")) : "";

interface Lab {
  kind: DatabaseKind;
  url: string;
  schema: string;
  types: Record<string, string>;
}

beforeAll(() => {
  if (!BRIDGE) return;
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      transformCallback: () => 0,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        const response = await fetch(BRIDGE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command, args }),
        });
        const body = (await response.json()) as { result?: unknown; error?: string };
        if (body.error) throw new Error(body.error);
        return body.result;
      },
    },
  });
});

afterAll(() => {
  if (SQLITE_DIR) rmSync(SQLITE_DIR, { recursive: true, force: true });
});

async function run(lab: Lab, statements: string[]) {
  for (const statement of statements) {
    try {
      await executeQuery(lab.kind, lab.url, statement, undefined, {
        confirmed: true,
        track: false,
      });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}\n--- ${statement}`);
    }
  }
}

function request(lab: Lab, maxRows = 1000) {
  const side = (table: string) => ({
    connectionString: lab.url,
    database: null,
    kind: lab.kind,
    source: {
      schema: lab.schema,
      table,
      allowRawFilter: false,
      orderDesc: false,
      isView: false,
      maxRows,
    },
  });
  return {
    left: side("dc_src"),
    right: side("dc_dst"),
    keyColumns: ["id"],
    compareColumns: Object.keys(lab.types).filter((column) => column !== "id"),
  };
}

async function converge(lab: Lab) {
  const first = await compareTableDataRemote(request(lab));
  expect(first.counts).toEqual({ only_left: 1, only_right: 1, changed: 2, equal: 1 });
  await expect(compareTableDataRemote(request(lab, 2))).rejects.toThrow(/Zeilenlimit/);
  const script = buildSyncScript({
    rows: first.rows,
    direction: "left_to_right",
    target: { schema: lab.schema, table: "dc_dst" },
    keyColumns: ["id"],
    compareColumns: request(lab).compareColumns,
    kind: lab.kind,
    columnTypes: lab.types,
    includeDeletes: true,
  });
  expect([script.insertCount, script.updateCount, script.deleteCount]).toEqual([1, 2, 1]);
  await run(
    lab,
    splitSqlStatements(script.sql, lab.kind).statements.map((statement) => statement.text),
  );
  const second = await compareTableDataRemote(request(lab));
  expect(second.counts).toEqual({ only_left: 0, only_right: 0, changed: 0, equal: 4 });
}

describe.skipIf(!BRIDGE || !MYSQL_URL)("Datenvergleich MySQL live", () => {
  const lab: Lab = {
    kind: "mysql",
    url: MYSQL_URL ?? "",
    schema: "dclab",
    types: {
      id: "int",
      name: "varchar",
      amount: "decimal",
      day: "date",
      stamp: "datetime",
      data: "varbinary",
      flag: "tinyint",
      ratio: "double",
      doc: "json",
    },
  };
  const columns =
    "id int PRIMARY KEY, name varchar(60) NULL, amount decimal(24,6) NULL, day date NULL, stamp datetime(6) NULL, data varbinary(20) NULL, flag tinyint(1) NULL, ratio double NULL, doc json NULL";
  test(
    "gleicht Zeilen mit Sonderzeichen, Dezimal-, Datums- und Binärwerten an",
    async () => {
      await run(lab, [
        "DROP DATABASE IF EXISTS dclab",
        "CREATE DATABASE dclab CHARACTER SET utf8mb4",
        `CREATE TABLE dclab.dc_src (${columns})`,
        `CREATE TABLE dclab.dc_dst (${columns})`,
        `INSERT INTO dclab.dc_src VALUES (1, 'plain', 1.5, '2024-01-02', '2024-01-02 03:04:05.123456', X'00FF10', 1, 0.1, '{"a":[1,"x"]}'), (2, 'quote '' and back\\\\slash', 12345678901234.123456, NULL, NULL, X'', 0, NULL, NULL), (3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), (4, 'ümlaut 😀', -0.000001, '1999-12-31', '1999-12-31 23:59:59', NULL, 1, 1e10, '"s"')`,
        `INSERT INTO dclab.dc_dst VALUES (1, 'plain', 1.5, '2024-01-02', '2024-01-02 03:04:05.123456', X'00FF10', 1, 0.1, '{"a":[1,"x"]}'), (2, 'alt', 12345678901234.123456, NULL, NULL, X'', 0, NULL, NULL), (3, NULL, 5, NULL, NULL, X'01', NULL, NULL, NULL), (5, 'weg', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ]);
      await converge(lab);
      await run(lab, ["DROP DATABASE dclab"]);
    },
    TIMEOUT,
  );
});

describe.skipIf(!BRIDGE || !MSSQL_URL)("Datenvergleich SQL Server live", () => {
  const lab: Lab = {
    kind: "mssql",
    url: MSSQL_URL ?? "",
    schema: "dbo",
    types: {
      id: "int",
      name: "nvarchar",
      amount: "decimal",
      day: "date",
      stamp: "datetime2",
      legacy: "datetime",
      data: "varbinary",
      flag: "bit",
      ratio: "float",
      guid: "uniqueidentifier",
    },
  };
  const columns = (id: string) =>
    `id int ${id} PRIMARY KEY, name nvarchar(60) NULL, amount decimal(24,6) NULL, day date NULL, stamp datetime2(7) NULL, legacy datetime NULL, data varbinary(20) NULL, flag bit NULL, ratio float NULL, guid uniqueidentifier NULL`;
  test(
    "gleicht Zeilen inklusive Identitätsspalte an",
    async () => {
      await run(lab, [
        "DROP TABLE IF EXISTS dbo.dc_src, dbo.dc_dst",
        `CREATE TABLE dbo.dc_src (${columns("")})`,
        `CREATE TABLE dbo.dc_dst (${columns("IDENTITY(1,1)")})`,
        `INSERT INTO dbo.dc_src VALUES (1, N'plain', 1.5, '2024-01-02', '2024-01-02T03:04:05.1234567', '2024-01-02T03:04:05.003', 0x00FF10, 1, 0.1, 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), (2, N'quote '' and back\\slash', 12345678901234.123456, NULL, NULL, NULL, 0x, 0, NULL, NULL), (3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), (4, N'ümlaut 😀', -0.000001, '1999-12-31', '1999-12-31T23:59:59.9999999', '1999-12-31T23:59:59', NULL, 1, 1e10, NULL)`,
        `SET IDENTITY_INSERT dbo.dc_dst ON; INSERT INTO dbo.dc_dst (id, name, amount, day, stamp, legacy, data, flag, ratio, guid) VALUES (1, N'plain', 1.5, '2024-01-02', '2024-01-02T03:04:05.1234567', '2024-01-02T03:04:05.003', 0x00FF10, 1, 0.1, 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), (2, N'alt', 12345678901234.123456, NULL, NULL, NULL, 0x, 0, NULL, NULL), (3, NULL, 5, NULL, NULL, '2000-01-01', 0x01, NULL, NULL, NULL), (5, N'weg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL); SET IDENTITY_INSERT dbo.dc_dst OFF`,
      ]);
      await converge(lab);
      await run(lab, ["DROP TABLE dbo.dc_src, dbo.dc_dst"]);
    },
    TIMEOUT,
  );
});

describe.skipIf(!BRIDGE)("Datenvergleich SQLite live", () => {
  const lab: Lab = {
    kind: "sqlite",
    url: join(SQLITE_DIR, "data.db"),
    schema: "main",
    types: {
      id: "INTEGER",
      name: "TEXT",
      amount: "NUMERIC",
      day: "TEXT",
      data: "BLOB",
      flag: "INTEGER",
      ratio: "REAL",
    },
  };
  const columns =
    "id INTEGER PRIMARY KEY, name TEXT, amount NUMERIC, day TEXT, data BLOB, flag INTEGER, ratio REAL";
  test(
    "gleicht Zeilen mit Blob- und Textwerten an",
    async () => {
      await run(lab, [
        `CREATE TABLE dc_src (${columns})`,
        `CREATE TABLE dc_dst (${columns})`,
        `INSERT INTO dc_src VALUES (1, 'plain', 1.5, '2024-01-02', X'00FF10', 1, 0.1), (2, 'quote '' and back\\slash', 12.25, NULL, X'', 0, NULL), (3, NULL, NULL, NULL, NULL, NULL, NULL), (4, 'ümlaut 😀', -0.5, '1999-12-31', NULL, 1, 1e10)`,
        `INSERT INTO dc_dst VALUES (1, 'plain', 1.5, '2024-01-02', X'00FF10', 1, 0.1), (2, 'alt', 12.25, NULL, X'', 0, NULL), (3, NULL, 5, NULL, X'01', NULL, NULL), (5, 'weg', NULL, NULL, NULL, NULL, NULL)`,
      ]);
      await converge(lab);
    },
    TIMEOUT,
  );
});
