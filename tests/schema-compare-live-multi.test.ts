import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type SavedConnection, useConnectionsStore } from "../src/lib/connections";
import { type CatalogObject, executeQuery, loadSchemaCatalog } from "../src/lib/db";
import { defaultSelection } from "../src/lib/schema-compare/diff";
import { dryRunKind, type RunStep, runSyncStatements } from "../src/lib/schema-compare/run";
import { buildSyncScript, renderSyncScript } from "../src/lib/schema-compare/script";
import {
  reverseSchemaCompare,
  runSchemaCompare,
  useSchemaCompareStore,
} from "../src/lib/schema-compare/store";
import {
  type CompareResult,
  type CompareSide,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
} from "../src/lib/schema-compare/types";

const BRIDGE = process.env.L8DB_SCHEMA_COMPARE_LIVE;
const MYSQL_URL = process.env.L8DB_SC_MYSQL_URL;
const MSSQL_URL = process.env.L8DB_SC_MSSQL_URL;
const TIMEOUT = 600_000;
const SQLITE_DIR = BRIDGE ? mkdtempSync(join(tmpdir(), "l8db-sc-")) : "";

const MY: SavedConnection = {
  id: "sc-my",
  name: "MySQL Lab",
  kind: "mysql",
  connectionString: MYSQL_URL ?? "",
  sslMode: "disable",
};
const MS: SavedConnection = {
  id: "sc-ms",
  name: "SQL Server Lab",
  kind: "mssql",
  connectionString: MSSQL_URL ?? "",
  sslMode: "disable",
};
const LITE_A: SavedConnection = {
  id: "sc-lite-a",
  name: "SQLite A",
  kind: "sqlite",
  connectionString: join(SQLITE_DIR, "a.db"),
  sslMode: "disable",
};
const LITE_B: SavedConnection = { ...LITE_A, id: "sc-lite-b", name: "SQLite B" };
const CONNECTIONS = [MY, MS, LITE_A, LITE_B];

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
  useConnectionsStore.setState({ connections: CONNECTIONS });
});

function connectionById(id: string | null): SavedConnection {
  const found = useConnectionsStore.getState().connections.find((item) => item.id === id);
  if (!found) throw new Error(`Unbekannte Verbindung ${id}`);
  return found;
}

async function run(connection: SavedConnection, statements: string[], database?: string) {
  for (const statement of statements) {
    try {
      await executeQuery(connection.kind, connection.connectionString, statement, database, {
        confirmed: true,
        track: false,
      });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}\n--- ${statement}`);
    }
  }
}

function statements(text: string): string[] {
  return text
    .split(/\n--\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function catalog(side: CompareSide): Promise<CatalogObject[]> {
  const connection = connectionById(side.connectionId);
  const objects = await loadSchemaCatalog(
    connection.kind,
    connection.connectionString,
    side.schema ?? "",
    compareTypesFor(connection.kind),
    side.database ?? undefined,
  );
  return objects.sort((a, b) =>
    `${a.object_type}|${a.parent}|${a.name}`.localeCompare(
      `${b.object_type}|${b.parent}|${b.name}`,
    ),
  );
}

async function compare(source: CompareSide, target: CompareSide): Promise<CompareResult> {
  useSchemaCompareStore.setState({
    source,
    target,
    types: compareTypesFor(connectionById(source.connectionId).kind),
    options: DEFAULT_COMPARE_OPTIONS,
    result: null,
    error: null,
  });
  await runSchemaCompare();
  return current();
}

function current(): CompareResult {
  const { result, error } = useSchemaCompareStore.getState();
  if (error || !result) throw new Error(error ?? "Kein Vergleichsergebnis");
  return result;
}

function open(result: CompareResult): string[] {
  return result.items
    .filter((item) => item.status !== "identical")
    .map(
      (item) => `${item.status} ${item.type} ${item.parent ?? ""}.${item.name} ${item.differsBy}`,
    )
    .sort();
}

function everything(result: CompareResult): Record<string, boolean> {
  return Object.fromEntries(
    result.items.filter((item) => item.status !== "identical").map((item) => [item.key, true]),
  );
}

async function apply(result: CompareResult, selection: Record<string, boolean>, dryRun = false) {
  const script = buildSyncScript(result, selection);
  const steps: RunStep[] = [];
  const summary = await runSyncStatements(
    connectionById(result.target.connectionId),
    { database: result.target.database, schema: result.targetSchema },
    script.statements,
    {
      continueOnError: false,
      dryRun,
      stopped: () => false,
      onStep: (index, step) => {
        steps[index] = step;
      },
    },
  );
  const problems = script.statements
    .map((statement, index) => ({ statement, step: steps[index] }))
    .filter(({ step }) => step?.status === "error" || (!dryRun && step?.status === "warning"))
    .map(({ statement, step }) => `${step.message}\n--- ${statement.sql}`);
  if (summary.failed > 0 || problems.length > 0)
    throw new Error(
      `${dryRun ? "Probelauf" : "Ausführung"} fehlgeschlagen:\n${problems.join("\n\n")}\n\n${renderSyncScript(script, { kind: result.kind, sourceLabel: "", targetLabel: "" })}`,
    );
  return { script, summary };
}

function blocked(warnings: string[]): string[] {
  return warnings
    .filter((warning) => /berechnete Spalte|manuell angepasst/.test(warning))
    .map((warning) => /^Spalte (\S+):/.exec(warning)?.[1] ?? warning)
    .sort();
}

function openColumns(result: CompareResult): string[] {
  return result.items
    .filter((item) => item.status === "different" && item.type === "column")
    .map((item) => `${item.parent}.${item.name}`)
    .sort();
}

async function converge(result: CompareResult, selection = everything(result)) {
  const target = result.target;
  const kind = connectionById(target.connectionId).kind;
  if (dryRunKind(kind) === "rollback") {
    const before = await catalog(target);
    const dry = await apply(result, selection, true);
    expect(dry.summary.incomplete).toBe(false);
    expect(await catalog(target)).toEqual(before);
  }
  const { script } = await apply(result, selection);
  const source = useSchemaCompareStore.getState().source;
  const after = await compare(source, target);
  return { after, expected: blocked(script.warnings), script };
}

function expectConverged(outcome: { after: CompareResult; expected: string[] }) {
  expect(openColumns(outcome.after)).toEqual(outcome.expected);
  expect(open(outcome.after).filter((line) => !line.startsWith("different column"))).toEqual([]);
}

function mysqlRich(s: string): string {
  return `
DROP DATABASE IF EXISTS ${s}
--
CREATE DATABASE ${s}
--
CREATE TABLE ${s}.customer (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(200),
  status varchar(10) DEFAULT 'new',
  created timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  score decimal(8,2) DEFAULT 0.00,
  code varchar(20) COLLATE utf8mb4_bin,
  name_upper varchar(80) GENERATED ALWAYS AS (upper(name)) VIRTUAL,
  UNIQUE KEY customer_email (email),
  CONSTRAINT customer_status CHECK (status in ('new', 'old'))
)
--
CREATE TABLE ${s}.orders (
  id bigint NOT NULL PRIMARY KEY,
  customer_id int NOT NULL,
  amount decimal(12,2) NOT NULL,
  note text,
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES ${s}.customer (id) ON DELETE CASCADE,
  CHECK (amount >= 0)
)
--
CREATE INDEX orders_amount_idx ON ${s}.orders (amount DESC)
--
CREATE TABLE ${s}.audit (id int NOT NULL PRIMARY KEY, msg varchar(100))
--
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 100
--
CREATE VIEW ${s}.big_names AS SELECT name FROM ${s}.big_orders
--
CREATE FUNCTION ${s}.order_total(c int) RETURNS decimal(12,2) DETERMINISTIC READS SQL DATA RETURN (SELECT coalesce(sum(amount), 0) FROM ${s}.orders WHERE customer_id = c)
--
CREATE PROCEDURE ${s}.purge(IN days int) BEGIN DELETE FROM ${s}.orders WHERE id < days; END
--
CREATE TRIGGER ${s}.customer_touch BEFORE UPDATE ON ${s}.customer FOR EACH ROW BEGIN SET NEW.name = trim(NEW.name); END
--
INSERT INTO ${s}.customer (name, email) VALUES ('Ada', 'ada@example.com'), ('Bob', 'bob@example.com')
--
INSERT INTO ${s}.orders (id, customer_id, amount) VALUES (1, 1, 150), (2, 2, 20)
`;
}

function mysqlVariant(s: string): string {
  return `
DROP DATABASE IF EXISTS ${s}
--
CREATE DATABASE ${s}
--
CREATE TABLE ${s}.customer (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(150) NOT NULL,
  status varchar(10) DEFAULT 'old',
  created timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  code varchar(20),
  name_upper varchar(80) GENERATED ALWAYS AS (upper(name)) VIRTUAL,
  legacy_flag tinyint(1),
  UNIQUE KEY customer_email (email),
  CONSTRAINT customer_status CHECK (status in ('new', 'old', 'x'))
)
--
CREATE TABLE ${s}.orders (
  id bigint NOT NULL PRIMARY KEY,
  customer_id int NOT NULL,
  amount decimal(12,2) NOT NULL,
  note text,
  INDEX orders_customer_idx (customer_id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES ${s}.customer (id),
  CHECK (amount >= 1)
)
--
CREATE TABLE ${s}.audit (id int NOT NULL PRIMARY KEY)
--
CREATE TABLE ${s}.legacy (id int NOT NULL PRIMARY KEY, customer_id int, FOREIGN KEY (customer_id) REFERENCES ${s}.customer (id))
--
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 50
--
CREATE VIEW ${s}.big_names AS SELECT name FROM ${s}.big_orders
--
CREATE VIEW ${s}.legacy_view AS SELECT id FROM ${s}.legacy
--
CREATE FUNCTION ${s}.order_total(c int) RETURNS decimal(12,2) DETERMINISTIC READS SQL DATA RETURN (SELECT sum(amount) FROM ${s}.orders WHERE customer_id = c)
--
CREATE PROCEDURE ${s}.purge(IN days int) BEGIN DELETE FROM ${s}.orders WHERE id < days; END
--
CREATE PROCEDURE ${s}.legacy_proc() BEGIN SELECT 1; END
--
INSERT INTO ${s}.customer (name, email) VALUES ('Cleo', 'cleo@example.com')
--
INSERT INTO ${s}.orders (id, customer_id, amount) VALUES (1, 1, 70)
`;
}

const mySide = (schema: string): CompareSide => ({
  connectionId: MY.id,
  database: null,
  schema,
});

describe.skipIf(!BRIDGE || !MYSQL_URL)("Schema-Vergleich live: MySQL", () => {
  test(
    "erstellt alle Objekttypen in einem leeren Zielschema",
    async () => {
      await run(MY, statements(mysqlRich("sca")));
      await run(MY, ["DROP DATABASE IF EXISTS scc", "CREATE DATABASE scc"]);
      const result = await compare(mySide("sca"), mySide("scc"));
      expect(result.items.every((item) => item.status === "only_source")).toBe(true);
      const types = new Set(
        result.items.flatMap((item) => [
          item.type,
          ...item.children.map((child) => child.object_type),
        ]),
      );
      expect(compareTypesFor("mysql").filter((type) => !types.has(type))).toEqual([]);
      const outcome = await converge(result, defaultSelection(result.items));
      expect(open(outcome.after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "gleicht Unterschiede in beide Richtungen an",
    async () => {
      await run(MY, statements(mysqlRich("sca")));
      await run(MY, statements(mysqlVariant("scb")));
      const forward = await compare(mySide("sca"), mySide("scb"));
      expect([...new Set(forward.items.map((item) => item.status))].sort()).toEqual([
        "different",
        "identical",
        "only_source",
        "only_target",
      ]);
      expectConverged(await converge(forward));
      await run(MY, statements(mysqlVariant("scb")));
      await compare(mySide("sca"), mySide("scb"));
      await reverseSchemaCompare();
      expectConverged(await converge(current()));
    },
    TIMEOUT,
  );

  test(
    "löscht alles, wenn die Quelle leer ist",
    async () => {
      await run(MY, ["DROP DATABASE IF EXISTS scc", "CREATE DATABASE scc"]);
      await run(MY, statements(mysqlRich("scd")));
      const result = await compare(mySide("scc"), mySide("scd"));
      const outcome = await converge(result);
      expect(open(outcome.after)).toEqual([]);
      expect(await catalog(mySide("scd"))).toEqual([]);
    },
    TIMEOUT,
  );
});

function mssqlRich(s: string): string {
  return `
CREATE SCHEMA ${s}
--
CREATE TABLE ${s}.customer (
  id int IDENTITY(1,1) CONSTRAINT customer_pk PRIMARY KEY,
  name nvarchar(80) NOT NULL,
  email varchar(200) NULL CONSTRAINT customer_email UNIQUE,
  status varchar(10) CONSTRAINT status_df DEFAULT 'new',
  created datetime2 NOT NULL DEFAULT sysdatetime(),
  score decimal(8,2) DEFAULT 0,
  code varchar(20) COLLATE Latin1_General_BIN2,
  name_upper AS upper(name),
  CONSTRAINT customer_status CHECK (status IN ('new', 'old'))
)
--
CREATE TABLE ${s}.orders (
  id bigint NOT NULL CONSTRAINT orders_pk PRIMARY KEY,
  customer_id int NOT NULL,
  amount decimal(12,2) NOT NULL,
  note nvarchar(200),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES ${s}.customer (id) ON DELETE CASCADE,
  CHECK (amount >= 0)
)
--
CREATE INDEX orders_amount_idx ON ${s}.orders (amount DESC) INCLUDE (note) WHERE amount > 100
--
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 100
--
CREATE VIEW ${s}.big_names AS SELECT name FROM ${s}.big_orders
--
CREATE FUNCTION ${s}.order_total(@c int) RETURNS decimal(12,2) AS BEGIN RETURN (SELECT coalesce(sum(amount), 0) FROM ${s}.orders WHERE customer_id = @c) END
--
CREATE PROCEDURE ${s}.purge @days int AS DELETE FROM ${s}.orders WHERE id < @days
--
CREATE TRIGGER ${s}.customer_touch ON ${s}.customer AFTER UPDATE AS SET NOCOUNT ON
--
CREATE TRIGGER ${s}.customer_touch_insert ON ${s}.customer AFTER INSERT AS SET NOCOUNT ON
--
DISABLE TRIGGER ${s}.customer_touch_insert ON ${s}.customer
--
INSERT INTO ${s}.customer (name, email) VALUES ('Ada', 'ada@example.com'), ('Bob', 'bob@example.com')
--
INSERT INTO ${s}.orders (id, customer_id, amount) VALUES (1, 1, 150), (2, 2, 20)
`;
}

function mssqlVariant(s: string): string {
  return `
CREATE SCHEMA ${s}
--
CREATE TABLE ${s}.customer (
  id int IDENTITY(1,1) CONSTRAINT customer_pk PRIMARY KEY,
  name nvarchar(80) NOT NULL,
  email varchar(150) NOT NULL CONSTRAINT customer_email UNIQUE,
  status varchar(10) CONSTRAINT status_df DEFAULT 'old',
  created datetime2 NULL DEFAULT sysdatetime(),
  code varchar(20),
  name_upper AS upper(name),
  legacy_flag bit NOT NULL DEFAULT 0,
  CONSTRAINT customer_status CHECK (status IN ('new', 'old', 'x'))
)
--
CREATE TABLE ${s}.orders (
  id bigint NOT NULL CONSTRAINT orders_pk PRIMARY KEY,
  customer_id int NOT NULL,
  amount decimal(10,2) NOT NULL,
  note nvarchar(200),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES ${s}.customer (id),
  CHECK (amount >= 1)
)
--
CREATE INDEX orders_customer_idx ON ${s}.orders (customer_id)
--
CREATE INDEX orders_amount_idx ON ${s}.orders (amount)
--
CREATE TABLE ${s}.legacy (id int NOT NULL PRIMARY KEY, customer_id int REFERENCES ${s}.customer (id))
--
CREATE VIEW ${s}.big_orders AS SELECT o.id, c.name FROM ${s}.orders o JOIN ${s}.customer c ON c.id = o.customer_id WHERE o.amount > 50
--
CREATE VIEW ${s}.big_names AS SELECT name FROM ${s}.big_orders
--
CREATE VIEW ${s}.legacy_view AS SELECT id FROM ${s}.legacy
--
CREATE FUNCTION ${s}.order_total(@c int) RETURNS decimal(12,2) AS BEGIN RETURN (SELECT sum(amount) FROM ${s}.orders WHERE customer_id = @c) END
--
CREATE PROCEDURE ${s}.purge @days int AS DELETE FROM ${s}.orders WHERE id < @days
--
CREATE PROCEDURE ${s}.legacy_proc AS SELECT 1
--
CREATE TRIGGER ${s}.customer_touch_insert ON ${s}.customer AFTER INSERT AS SET NOCOUNT ON
--
INSERT INTO ${s}.customer (name, email) VALUES ('Cleo', 'cleo@example.com')
--
INSERT INTO ${s}.orders (id, customer_id, amount) VALUES (1, 1, 70)
`;
}

const msSide = (schema: string): CompareSide => ({
  connectionId: MS.id,
  database: "sc",
  schema,
});

async function mssqlReset(schemas: string[]) {
  for (const schema of schemas) {
    const drops = ["V", "P", "FN", "IF", "TF"].map(
      (type) =>
        `DECLARE @sql nvarchar(max) = N''; SELECT @sql += N'DROP ${
          { V: "VIEW", P: "PROCEDURE", FN: "FUNCTION", IF: "FUNCTION", TF: "FUNCTION" }[type]
        } ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N'; ' FROM sys.objects WHERE schema_id = SCHEMA_ID(N'${schema}') AND type = '${type}'; EXEC(@sql)`,
    );
    await run(
      MS,
      [
        `DECLARE @sql nvarchar(max) = N''; SELECT @sql += N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(f.name) + N'; ' FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id = f.parent_object_id WHERE t.schema_id = SCHEMA_ID(N'${schema}'); EXEC(@sql)`,
        ...drops,
        `DECLARE @sql nvarchar(max) = N''; SELECT @sql += N'DROP TABLE ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N'; ' FROM sys.tables WHERE schema_id = SCHEMA_ID(N'${schema}'); EXEC(@sql)`,
        `IF SCHEMA_ID(N'${schema}') IS NOT NULL EXEC(N'DROP SCHEMA ${schema}')`,
      ],
      "sc",
    );
  }
}

describe.skipIf(!BRIDGE || !MSSQL_URL)("Schema-Vergleich live: SQL Server", () => {
  beforeAll(async () => {
    await run(MS, ["IF DB_ID(N'sc') IS NULL CREATE DATABASE sc"]);
  }, TIMEOUT);

  test(
    "erstellt alle Objekttypen in einem leeren Zielschema",
    async () => {
      await mssqlReset(["sca", "scc"]);
      await run(MS, [...statements(mssqlRich("sca")), "CREATE SCHEMA scc"], "sc");
      const result = await compare(msSide("sca"), msSide("scc"));
      expect(result.items.every((item) => item.status === "only_source")).toBe(true);
      const types = new Set(
        result.items.flatMap((item) => [
          item.type,
          ...item.children.map((child) => child.object_type),
        ]),
      );
      expect(compareTypesFor("mssql").filter((type) => !types.has(type))).toEqual([]);
      const outcome = await converge(result, defaultSelection(result.items));
      expect(open(outcome.after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "gleicht Unterschiede in beide Richtungen an",
    async () => {
      await mssqlReset(["sca", "scb"]);
      await run(MS, [...statements(mssqlRich("sca")), ...statements(mssqlVariant("scb"))], "sc");
      const forward = await compare(msSide("sca"), msSide("scb"));
      expect([...new Set(forward.items.map((item) => item.status))].sort()).toEqual([
        "different",
        "identical",
        "only_source",
        "only_target",
      ]);
      expectConverged(await converge(forward));
      await mssqlReset(["scb"]);
      await run(MS, statements(mssqlVariant("scb")), "sc");
      await compare(msSide("sca"), msSide("scb"));
      await reverseSchemaCompare();
      expectConverged(await converge(current()));
    },
    TIMEOUT,
  );

  test(
    "löscht alles, wenn die Quelle leer ist",
    async () => {
      await mssqlReset(["scc", "scd"]);
      await run(MS, ["CREATE SCHEMA scc", ...statements(mssqlRich("scd"))], "sc");
      const result = await compare(msSide("scc"), msSide("scd"));
      const outcome = await converge(result);
      expect(open(outcome.after)).toEqual([]);
      expect(await catalog(msSide("scd"))).toEqual([]);
    },
    TIMEOUT,
  );
});

const SQLITE_RICH = `
CREATE TABLE customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'old')),
  score REAL DEFAULT 0,
  name_upper TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL
)
--
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  note TEXT
)
--
CREATE INDEX orders_amount_idx ON orders (amount DESC) WHERE amount > 100
--
CREATE TABLE audit (id INTEGER PRIMARY KEY, msg TEXT, level INTEGER DEFAULT 1)
--
CREATE VIEW big_orders AS SELECT o.id, c.name FROM orders o JOIN customer c ON c.id = o.customer_id WHERE o.amount > 100
--
CREATE VIEW big_names AS SELECT name FROM big_orders
--
CREATE TRIGGER customer_touch AFTER UPDATE OF name ON customer BEGIN UPDATE customer SET score = score + 1 WHERE id = NEW.id; END
--
INSERT INTO customer (name, email) VALUES ('Ada', 'ada@example.com'), ('Bob', 'bob@example.com')
--
INSERT INTO orders (id, customer_id, amount) VALUES (1, 1, 150), (2, 2, 20)
--
INSERT INTO audit (id, msg) VALUES (1, 'x')
`;

const SQLITE_VARIANT = `
CREATE TABLE customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(60) NOT NULL,
  email TEXT UNIQUE,
  status TEXT DEFAULT 'old' CHECK (status IN ('new', 'old')),
  name_upper TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL,
  legacy_flag INTEGER
)
--
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer (id),
  amount NUMERIC NOT NULL CHECK (amount >= 1),
  note TEXT
)
--
CREATE INDEX orders_customer_idx ON orders (customer_id)
--
CREATE TABLE audit (id INTEGER PRIMARY KEY, msg TEXT)
--
CREATE TABLE legacy (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customer (id))
--
CREATE VIEW big_orders AS SELECT o.id, c.name FROM orders o JOIN customer c ON c.id = o.customer_id WHERE o.amount > 50
--
CREATE VIEW big_names AS SELECT name FROM big_orders
--
CREATE VIEW legacy_view AS SELECT id FROM legacy
--
INSERT INTO customer (name, email) VALUES ('Cleo', 'cleo@example.com')
--
INSERT INTO orders (id, customer_id, amount) VALUES (1, 1, 70)
--
INSERT INTO audit (id, msg) VALUES (1, 'y')
`;

let fileCounter = 0;

function sqliteFile(): SavedConnection {
  fileCounter += 1;
  return {
    ...LITE_A,
    id: `sc-lite-${fileCounter}`,
    name: `SQLite ${fileCounter}`,
    connectionString: join(SQLITE_DIR, `f${fileCounter}.db`),
  };
}

async function sqlitePair(source: string, target: string) {
  const left = sqliteFile();
  const right = sqliteFile();
  useConnectionsStore.setState({
    connections: [...useConnectionsStore.getState().connections, left, right],
  });
  await run(left, statements(source));
  await run(right, statements(target));
  const side = (connection: SavedConnection): CompareSide => ({
    connectionId: connection.id,
    database: null,
    schema: "main",
  });
  return { left: side(left), right: side(right) };
}

describe.skipIf(!BRIDGE)("Schema-Vergleich live: SQLite", () => {
  test(
    "erstellt alle Objekttypen in einer leeren Datei",
    async () => {
      const { left, right } = await sqlitePair(SQLITE_RICH, "");
      const result = await compare(left, right);
      expect(result.items.every((item) => item.status === "only_source")).toBe(true);
      const outcome = await converge(result, defaultSelection(result.items));
      expect(open(outcome.after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "baut Tabellen um und behält Daten, in beide Richtungen",
    async () => {
      const forward = await sqlitePair(SQLITE_RICH, SQLITE_VARIANT);
      const result = await compare(forward.left, forward.right);
      expect([...new Set(result.items.map((item) => item.status))].sort()).toEqual([
        "different",
        "identical",
        "only_source",
        "only_target",
      ]);
      const outcome = await converge(result);
      expect(open(outcome.after)).toEqual([]);
      expect(outcome.script.statements.some((item) => /_l8db_copy_customer/.test(item.sql))).toBe(
        true,
      );
      const target = connectionById(forward.right.connectionId);
      const rows = await executeQuery(
        target.kind,
        target.connectionString,
        "SELECT name, status FROM customer",
      );
      expect(rows.rows).toEqual([{ name: "Cleo", status: "old" }]);

      const reverse = await sqlitePair(SQLITE_RICH, SQLITE_VARIANT);
      await compare(reverse.left, reverse.right);
      await reverseSchemaCompare();
      const back = await converge(current());
      expect(open(back.after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "fügt nur eine Spalte per ALTER TABLE hinzu, wenn möglich",
    async () => {
      const pair = await sqlitePair(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b INTEGER DEFAULT 3)",
        "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)\n--\nINSERT INTO t VALUES (1, 'x')",
      );
      const result = await compare(pair.left, pair.right);
      const outcome = await converge(result);
      expect(outcome.script.statements.map((item) => item.sql)).toEqual([
        "PRAGMA defer_foreign_keys = ON",
        'ALTER TABLE "main"."t" ADD COLUMN b INTEGER DEFAULT 3',
      ]);
      expect(open(outcome.after)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "löscht alles, wenn die Quelle leer ist",
    async () => {
      const pair = await sqlitePair("", SQLITE_RICH);
      const result = await compare(pair.left, pair.right);
      const outcome = await converge(result);
      expect(open(outcome.after)).toEqual([]);
      expect(await catalog(pair.right)).toEqual([]);
      rmSync(SQLITE_DIR, { recursive: true, force: true });
    },
    TIMEOUT,
  );
});
