import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type SavedConnection, useConnectionsStore } from "../src/lib/connections";
import { executeQuery, loadSchemaCatalog } from "../src/lib/db";
import { compareCatalogs, defaultSelection } from "../src/lib/schema-compare/diff";
import { type RunStep, runSyncStatements } from "../src/lib/schema-compare/run";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import {
  type CompareResult,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
} from "../src/lib/schema-compare/types";

const BRIDGE = process.env.L8DB_SCHEMA_COMPARE_LIVE;
const TIMEOUT = 120_000;
const DIR = BRIDGE ? mkdtempSync(join(tmpdir(), "l8db-sc-fk-")) : "";
let counter = 0;

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
  if (DIR) rmSync(DIR, { recursive: true, force: true });
});

function file(): SavedConnection {
  counter += 1;
  const path = join(DIR, `f${counter}.db`);
  writeFileSync(path, "");
  const connection: SavedConnection = {
    id: `fk-${counter}`,
    name: `FK ${counter}`,
    kind: "sqlite",
    connectionString: path,
    sslMode: "disable",
  };
  useConnectionsStore.setState({
    connections: [...useConnectionsStore.getState().connections, connection],
  });
  return connection;
}

async function run(connection: SavedConnection, statements: string[]) {
  for (const sql of statements)
    await executeQuery(connection.kind, connection.connectionString, sql, undefined, {
      confirmed: true,
      track: false,
    });
}

async function rows(connection: SavedConnection, sql: string) {
  return (
    await executeQuery(connection.kind, connection.connectionString, sql, undefined, {
      confirmed: true,
      track: false,
    })
  ).rows;
}

async function compare(source: SavedConnection, target: SavedConnection): Promise<CompareResult> {
  const types = compareTypesFor("sqlite");
  const load = (connection: SavedConnection) =>
    loadSchemaCatalog(connection.kind, connection.connectionString, "main", types);
  const context = {
    kind: "sqlite" as const,
    sourceSchema: "main",
    targetSchema: "main",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  return {
    ...context,
    source: { connectionId: source.id, database: null, schema: "main" },
    target: { connectionId: target.id, database: null, schema: "main" },
    sourceLabel: "source",
    targetLabel: "target",
    types,
    items: compareCatalogs(await load(source), await load(target), context),
    comparedAt: "",
  };
}

async function sync(target: SavedConnection, result: CompareResult, dryRun = false) {
  const script = buildSyncScript(result, defaultSelection(result.items));
  const steps: RunStep[] = [];
  const summary = await runSyncStatements(
    target,
    { database: null, schema: "main" },
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
  return { script, summary, steps };
}

const CHILDREN = [
  "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE)",
  "CREATE TABLE nullable_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE SET NULL)",
];

const DATA = [
  "INSERT INTO parent (id, name) VALUES (1, 'a'), (2, 'b')",
  "INSERT INTO child (id, parent_id) VALUES (10, 1), (11, 2)",
  "INSERT INTO nullable_child (id, parent_id) VALUES (20, 1), (21, 2)",
];

describe.skipIf(!BRIDGE)("Schema-Vergleich live: SQLite-Neuaufbau mit Fremdschlüsseln", () => {
  test(
    "Neuaufbau einer referenzierten Tabelle löscht keine Kindzeilen",
    async () => {
      const source = file();
      const target = file();
      await run(source, [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        ...CHILDREN,
      ]);
      await run(target, [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT)",
        ...CHILDREN,
        ...DATA,
      ]);
      const result = await compare(source, target);
      const dry = await sync(target, result, true);
      expect(dry.summary.failed).toBe(0);
      const { script, summary, steps } = await sync(target, result);
      expect(script.statements.some((item) => /^DROP TABLE "main"\."parent"$/.test(item.sql))).toBe(
        true,
      );
      expect(steps.filter((step) => step.status === "error")).toEqual([]);
      expect(summary.failed).toBe(0);
      expect(await rows(target, "SELECT id, parent_id FROM child ORDER BY id")).toEqual([
        { id: 10, parent_id: 1 },
        { id: 11, parent_id: 2 },
      ]);
      expect(await rows(target, "SELECT id, parent_id FROM nullable_child ORDER BY id")).toEqual([
        { id: 20, parent_id: 1 },
        { id: 21, parent_id: 2 },
      ]);
      expect(await rows(target, "SELECT name FROM parent ORDER BY id")).toEqual([
        { name: "a" },
        { name: "b" },
      ]);
      expect(await rows(target, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    },
    TIMEOUT,
  );

  test(
    "rollt zurück, wenn der Neuaufbau Fremdschlüssel verletzt",
    async () => {
      const source = file();
      const target = file();
      await run(source, [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE)",
      ]);
      await run(target, [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER)",
        "INSERT INTO parent (id, name) VALUES (1, 'a')",
        "INSERT INTO child (id, parent_id) VALUES (10, 1), (11, 99)",
      ]);
      const result = await compare(source, target);
      const dry = await sync(target, result, true);
      expect(dry.summary.failed).toBe(1);
      const { summary, steps } = await sync(target, result);
      expect(summary.failed).toBe(1);
      expect(summary.rolledBack).toBe(true);
      expect(steps.some((step) => /Fremdschlüssel/.test(step.message ?? ""))).toBe(true);
      expect(await rows(target, "SELECT id, parent_id FROM child ORDER BY id")).toEqual([
        { id: 10, parent_id: 1 },
        { id: 11, parent_id: 99 },
      ]);
      expect((await rows(target, "SELECT sql FROM sqlite_master WHERE name = 'child'"))[0]).toEqual(
        { sql: "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER)" },
      );
      expect(await rows(target, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    },
    TIMEOUT,
  );

  test(
    "ein ungültiger Fremdschlüssel einer unbeteiligten Tabelle blockiert die Synchronisation nicht",
    async () => {
      const source = file();
      const target = file();
      const broken = [
        "CREATE TABLE p (id INTEGER PRIMARY KEY, code TEXT)",
        "CREATE TABLE c (pcode TEXT REFERENCES p(code))",
      ];
      await run(source, [...broken, "CREATE TABLE extra (id INTEGER PRIMARY KEY)"]);
      await run(target, broken);
      const result = await compare(source, target);
      const dry = await sync(target, result, true);
      expect(dry.steps.filter((step) => step.status === "error")).toEqual([]);
      expect(dry.summary.failed).toBe(0);
      const { summary, steps } = await sync(target, result);
      expect(steps.filter((step) => step.status === "error")).toEqual([]);
      expect(summary).toMatchObject({ failed: 0, rolledBack: false });
      expect(await rows(target, "SELECT name FROM sqlite_master WHERE name = 'extra'")).toEqual([
        { name: "extra" },
      ]);
      expect(await rows(target, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    },
    TIMEOUT,
  );
});
