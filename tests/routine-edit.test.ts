import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DatabaseKind } from "../src/lib/db";

const calls: { command: string; sql?: string }[] = [];
let routines = new Map<string, string>();
let denyDefiner = false;
let validated: string[] = [];
let procGrants: Record<string, unknown>[] | null = [];
let granted: string[] = [];

function key(name: string) {
  return name.replace(/`/g, "").toLowerCase();
}

function apply(sql: string) {
  const drop = /^DROP (?:FUNCTION|PROCEDURE) IF EXISTS (\S+)$/.exec(sql);
  if (drop) {
    routines.delete(key(drop[1]));
    return;
  }
  if (sql.includes("FAILTARGET") && !sql.includes("__l8db_routine_check_"))
    throw new Error("1305: target failed");
  if (sql.includes("BROKEN")) throw new Error("1064: You have an error in your SQL syntax");
  if (denyDefiner && /DEFINER/.test(sql))
    throw new Error("1227: Access denied; you need the SET_ANY_DEFINER privilege");
  const create =
    /^CREATE (?:OR REPLACE )?(?:DEFINER=\S+ )?(?:FUNCTION|PROCEDURE) (?:IF NOT EXISTS )?((?:`[^`]+`\.)?`?\w+`?)/.exec(
      sql,
    );
  if (!create) throw new Error(`unexpected statement ${sql}`);
  const name = key(create[1].includes(".") ? create[1] : `app.${create[1]}`);
  if (routines.has(name) && !/OR REPLACE/.test(sql) && !/IF NOT EXISTS/.test(sql))
    throw new Error(`1304: FUNCTION ${name} already exists`);
  routines.set(name, sql);
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, sql: typeof args.sql === "string" ? args.sql : undefined });
    if (command === "execute_query" && String(args.sql).startsWith("SELECT User")) {
      if (!procGrants)
        throw new Error("1142: SELECT command denied to user for table 'procs_priv'");
      return { columns: [], rows: procGrants, rows_affected: null, execution_time_ms: 1 };
    }
    if (command === "execute_query" && String(args.sql).startsWith("GRANT ")) {
      granted.push(String(args.sql));
      return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
    }
    if (command === "execute_query") {
      apply(String(args.sql));
      return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 2 };
    }
    if (command === "validate_sql") {
      validated.push(String(args.sql));
      return undefined;
    }
    return undefined;
  },
}));

const { useSettingsStore } = await import("../src/lib/settings");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { answerSqlConfirmation, useSqlConfirmation } = await import("../src/lib/sql-confirmation");
const { applyRoutine, checkRoutine, clickhouseReplaceSql, mysqlRoutineHead } = await import(
  "../src/features/functions/sql-object-edit/replace-routine"
);

useSqlConfirmation.subscribe((state) => {
  for (const request of state.requests)
    queueMicrotask(() => answerSqlConfirmation(request.id, true));
});

const ORIGINAL =
  "CREATE DEFINER=`root`@`%` FUNCTION `add_one`(x INT) RETURNS int\n    DETERMINISTIC\nRETURN x + 1";

function edit(definition: string, kind: DatabaseKind = "mysql", original = ORIGINAL) {
  return {
    kind,
    connectionString: `${kind}://u@h/app`,
    database: "app",
    schema: "app",
    original,
    definition,
  };
}

beforeEach(() => {
  calls.length = 0;
  validated = [];
  denyDefiner = false;
  procGrants = [];
  granted = [];
  routines = new Map([["app.add_one", ORIGINAL]]);
  useSettingsStore.setState({ confirmDestructiveQueries: false, productionReadOnly: false });
  useConnectionsStore.setState({ connections: [] });
});

describe("mysqlRoutineHead", () => {
  test("parses functions and procedures with and without definer or schema", () => {
    expect(mysqlRoutineHead(ORIGINAL)).toMatchObject({
      type: "FUNCTION",
      schema: null,
      name: "add_one",
    });
    expect(mysqlRoutineHead("CREATE PROCEDURE `my``db`.`p 1`() BEGIN SELECT 1; END")).toMatchObject(
      { type: "PROCEDURE", schema: "my`db", name: "p 1" },
    );
    expect(
      mysqlRoutineHead("create definer = 'a'@'localhost' aggregate function f() returns int"),
    ).toMatchObject({ type: "FUNCTION", name: "f" });
    expect(mysqlRoutineHead("CREATE OR REPLACE FUNCTION f() RETURNS INT RETURN 1")).toBeNull();
    expect(mysqlRoutineHead("ALTER FUNCTION f COMMENT 'x'")).toBeNull();
  });
});

describe("applyRoutine on MySQL", () => {
  test("saving an unchanged existing function replaces it instead of failing", async () => {
    await applyRoutine(edit(ORIGINAL));
    expect(routines.get("app.add_one")).toContain("RETURN x + 1");
    expect(routines.size).toBe(1);
  });

  test("saving an edited procedure replaces it in the routine's schema", async () => {
    const original = "CREATE DEFINER=`root`@`%` PROCEDURE `p`()\nBEGIN SELECT 1; END";
    routines = new Map([["app.p", original]]);
    await applyRoutine(edit(original.replace("SELECT 1", "SELECT 2"), "mysql", original));
    expect(routines.get("app.p")).toContain("SELECT 2");
    expect(routines.get("app.p")).toContain("`app`.`p`");
    expect(routines.size).toBe(1);
  });

  test("a broken definition leaves the original untouched", async () => {
    await expect(applyRoutine(edit(`${ORIGINAL} BROKEN`))).rejects.toThrow("1064");
    expect(routines.get("app.add_one")).toBe(ORIGINAL);
    expect(
      calls.some((call) => call.sql?.startsWith("DROP FUNCTION IF EXISTS `app`.`add_one`")),
    ).toBe(false);
  });

  test("restores the original without definer when the new body fails after the drop", async () => {
    denyDefiner = true;
    const definition = `CREATE FUNCTION \`add_one\`(x INT) RETURNS int DETERMINISTIC RETURN x + 2 -- FAILTARGET`;
    await expect(applyRoutine(edit(definition))).rejects.toThrow("ohne seinen DEFINER");
    expect(routines.get("app.add_one")).not.toContain("DEFINER");
    expect([...routines.keys()]).toEqual(["app.add_one"]);
  });

  test("reports the original definition when it cannot be restored", async () => {
    const definition = `CREATE FUNCTION \`add_one\`(x INT) RETURNS int DETERMINISTIC RETURN x + 2 -- FAILTARGET`;
    const original =
      "CREATE FUNCTION `add_one`(x INT) RETURNS int DETERMINISTIC RETURN x + 1 BROKEN";
    routines = new Map([["app.add_one", original]]);
    await expect(applyRoutine(edit(definition, "mysql", original))).rejects.toThrow(
      "Ursprüngliche Definition",
    );
  });

  test("a renamed routine is created next to the original", async () => {
    await applyRoutine(edit(ORIGINAL.replace("`add_one`", "`add_two`")));
    expect([...routines.keys()].sort()).toEqual(["app.add_one", "app.add_two"]);
  });

  test("checking compiles a scratch copy and removes it again", async () => {
    await checkRoutine(edit(ORIGINAL));
    expect(validated).toEqual([]);
    expect([...routines.keys()]).toEqual(["app.add_one"]);
    expect(routines.get("app.add_one")).toBe(ORIGINAL);
    await expect(checkRoutine(edit(`${ORIGINAL} BROKEN`))).rejects.toThrow("1064");
    expect([...routines.keys()]).toEqual(["app.add_one"]);
  });
});

describe("routine grants on MySQL", () => {
  test("grants on the replaced routine are restored", async () => {
    procGrants = [
      { user: "app_user", host: "%", privileges: "Execute" },
      { user: "o'neil", host: "10.0.0.%", privileges: "Execute,Alter Routine,Grant" },
      { user: "nobody", host: "%", privileges: "" },
    ];
    const result = await applyRoutine(edit(ORIGINAL));
    expect(result.warning).toBeUndefined();
    expect(granted).toEqual([
      "GRANT EXECUTE ON FUNCTION `app`.`add_one` TO 'app_user'@'%'",
      "GRANT EXECUTE, ALTER ROUTINE ON FUNCTION `app`.`add_one` TO 'o''neil'@'10.0.0.%' WITH GRANT OPTION",
    ]);
    const lookup = calls.find((call) => call.sql?.startsWith("SELECT User"))?.sql;
    expect(lookup).toContain(
      "Db = 'app' AND Routine_name = 'add_one' AND Routine_type = 'FUNCTION'",
    );
  });

  test("grants are restored after a failed save restores the original", async () => {
    procGrants = [{ user: "app_user", host: "%", privileges: "Execute" }];
    const definition =
      "CREATE FUNCTION `add_one`(x INT) RETURNS int DETERMINISTIC RETURN x + 2 -- FAILTARGET";
    await expect(applyRoutine(edit(definition))).rejects.toThrow("target failed");
    expect(routines.get("app.add_one")).toContain("RETURN x + 1");
    expect(granted).toHaveLength(1);
  });

  test("warns when the grants cannot be read", async () => {
    procGrants = null;
    const result = await applyRoutine(edit(ORIGINAL));
    expect(result.warning).toContain("mysql.procs_priv");
  });
});

describe("other dialects", () => {
  test("Postgres, SQL Server and Oracle run their own CREATE OR REPLACE/ALTER text", async () => {
    for (const kind of ["postgres", "mssql", "oracle"] as DatabaseKind[]) {
      const sql = "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql";
      calls.length = 0;
      routines = new Map();
      await applyRoutine(edit(sql, kind, sql));
      expect(calls.filter((call) => call.command === "execute_query").map((c) => c.sql)).toEqual([
        sql,
      ]);
      await checkRoutine(edit(sql, kind, sql));
    }
    expect(validated).toHaveLength(3);
  });

  test("ClickHouse functions are replaced instead of failing with already exists", () => {
    const original = "CREATE FUNCTION linear AS (x, k, b) -> ((k * x) + b)";
    expect(clickhouseReplaceSql(edit(original, "clickhouse", original))).toBe(
      "CREATE OR REPLACE FUNCTION linear AS (x, k, b) -> ((k * x) + b)",
    );
    expect(
      clickhouseReplaceSql(edit("CREATE FUNCTION other AS (x) -> x", "clickhouse", original)),
    ).toBe("CREATE FUNCTION other AS (x) -> x");
  });
});
