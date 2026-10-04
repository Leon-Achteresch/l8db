import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E = process.env.L8DB_AUTOMATION_E2E === "1";
const BIN = process.env.L8DB_BIN ?? join(import.meta.dir, "../src-tauri/target/debug/l8db");

const SCHEMA_V1 = `
CREATE TABLE connections (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE task_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  next_run_at TEXT, last_run_at TEXT, last_run_id TEXT, last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0, disabled_reason TEXT,
  schedule_marks TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_name TEXT NOT NULL, trigger TEXT NOT NULL, trigger_detail TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, error TEXT, environment TEXT,
  rerun_of TEXT, parent_run_id TEXT, steps_total INTEGER NOT NULL, steps_done INTEGER NOT NULL DEFAULT 0,
  vars_json TEXT NOT NULL, definition_json TEXT NOT NULL, pid INTEGER NOT NULL
);
CREATE INDEX runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX runs_started ON runs(started_at DESC);
CREATE TABLE run_steps (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, seq));
CREATE TABLE run_logs (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, at TEXT NOT NULL, level TEXT NOT NULL, step_id TEXT, message TEXT NOT NULL, PRIMARY KEY (run_id, seq));
CREATE TABLE run_outputs (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER, format TEXT NOT NULL);
CREATE TABLE alerts (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, step_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (task_id, step_id));
CREATE TABLE leases (task_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pid INTEGER NOT NULL, heartbeat_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
PRAGMA user_version = 1;
`;

const CSV = {
  delimiter: ",",
  quote: '"',
  header: true,
  nullText: "",
  lineEnding: "\n",
  bom: false,
};

let dir = "";
let storePath = "";
let dataPath = "";
let outDir = "";

type Step = { id: string; name: string; action: Record<string, unknown> };

function env() {
  return {
    ...process.env,
    L8DB_AUTOMATION_DB: storePath,
    L8DB_DEV_SECRETS: join(dir, "secrets.json"),
  };
}

function cli(args: string[]) {
  return spawnSync(BIN, args, { env: env(), encoding: "utf8", timeout: 60_000 });
}

function store() {
  return new Database(storePath);
}

function addTask(task: Record<string, unknown>, nextRunAt: string | null = null) {
  const now = new Date().toISOString();
  const full = { enabled: true, revision: 1, createdAt: now, updatedAt: now, ...task };
  const db = store();
  db.run("INSERT INTO tasks (id, name, json, revision, updated_at) VALUES (?, ?, ?, 1, ?)", [
    full.id as string,
    full.name as string,
    JSON.stringify(full),
    now,
  ]);
  db.run("INSERT INTO task_state (task_id, next_run_at) VALUES (?, ?)", [
    full.id as string,
    nextRunAt,
  ]);
  db.close();
}

function setting(key: string, value: unknown) {
  const db = store();
  db.run("INSERT OR REPLACE INTO settings (key, json) VALUES (?, ?)", [key, JSON.stringify(value)]);
  db.close();
}

function runs(taskId: string) {
  const db = new Database(storePath);
  const rows = db
    .query("SELECT id, status, trigger, error FROM runs WHERE task_id = ? ORDER BY started_at")
    .all(taskId) as { id: string; status: string; trigger: string; error: string | null }[];
  db.close();
  return rows;
}

const sql = (id: string, statement: string): Step => ({
  id,
  name: "SQL",
  action: { type: "sql", connections: ["conn-data"], sql: statement },
});

const exportCsv = (id: string): Step => ({
  id,
  name: "Export",
  action: {
    type: "export",
    connection: "conn-data",
    source: { type: "query", sql: "SELECT id, status, total FROM orders ORDER BY id" },
    format: "csv",
    output: { path: "${datei}.csv", ifExists: "overwrite" },
    csv: CSV,
  },
});

const rowCount = (id: string, expected: number): Step => ({
  id,
  name: "Prüfung",
  action: {
    type: "check",
    connection: "conn-data",
    check: {
      type: "row_count",
      schema: null,
      table: "orders",
      sql: null,
      op: "eq",
      value: expected,
    },
    severity: "error",
  },
});

describe.skipIf(!E2E)("Automatisierungs-CLI mit echtem Binary", () => {
  beforeEach(() => {
    if (!existsSync(BIN)) throw new Error(`Binary fehlt: ${BIN} (zuerst cargo build)`);
    dir = mkdtempSync(join(tmpdir(), "l8db-automation-e2e-"));
    storePath = join(dir, "automation.db");
    dataPath = join(dir, "daten.db");
    outDir = join(dir, "out");
    mkdirSync(outDir);
    const data = new Database(dataPath, { create: true });
    data.exec(
      "CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, total INTEGER NOT NULL);" +
        "INSERT INTO orders VALUES (1, 'new', 10), (2, 'open', 20), (3, 'open', 30);" +
        "CREATE TABLE marker (at TEXT NOT NULL);",
    );
    data.close();
    const db = new Database(storePath, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA_V1);
    db.run("INSERT INTO connections (id, json, updated_at) VALUES (?, ?, ?)", [
      "conn-data",
      JSON.stringify({
        id: "conn-data",
        name: "Daten",
        kind: "sqlite",
        connectionString: `sqlite://${dataPath}`,
      }),
      new Date().toISOString(),
    ]);
    db.close();
    setting("settings", { defaultOutputDir: outDir });
    addTask({
      id: "bericht",
      name: "Bericht",
      variables: [{ name: "datei", defaultValue: "bericht" }],
      steps: [
        sql("s1", "UPDATE orders SET status = 'done' WHERE id = 1"),
        exportCsv("s2"),
        rowCount("s3", 3),
      ],
    });
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("--list-tasks --json ist parsebar", () => {
    const result = cli(["--list-tasks", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const tasks = JSON.parse(result.stdout) as { task: { id: string; name: string } }[];
    expect(tasks.map((summary) => summary.task.name)).toEqual(["Bericht"]);
    const table = cli(["--list-tasks"]);
    expect(table.status, table.stderr).toBe(0);
    expect(table.stdout).toContain("Bericht");
  }, 60_000);

  test("unbekannter Task liefert Exitcode 3", () => {
    const result = cli(["--run-task", "Gibt es nicht"]);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain("Gibt es nicht");
  }, 60_000);

  test("ungültige Aufrufe liefern Exitcode 2", () => {
    expect(cli(["--run-task"]).status).toBe(2);
    expect(cli(["--list-tasks", "--bogus"]).status).toBe(2);
    expect(cli(["--run-task", "Bericht", "--var", "ohne-gleich"]).status).toBe(2);
    const unknown = cli(["--run-task", "Bericht", "--var", "zeil=x"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Unbekannte Variable „zeil“. Bekannt: datei.");
  }, 60_000);

  test("SQL → Export CSV → Prüfung läuft erfolgreich", () => {
    const result = cli(["--run-task", "Bericht", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const detail = JSON.parse(result.stdout);
    expect(detail.summary.status).toBe("success");
    expect(detail.definition).toBeUndefined();
    const csv = readFileSync(join(outDir, "bericht.csv"), "utf8").trim().split("\n");
    expect(csv).toEqual(["id,status,total", "1,done,10", "2,open,20", "3,open,30"]);
    expect(runs("bericht")).toMatchObject([{ status: "success", trigger: "cli" }]);
  }, 60_000);

  test("--var überschreibt den Dateinamen", () => {
    const result = cli(["--run-task", "bericht", "--var", "datei=anders", "--quiet"]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(outDir, "anders.csv"))).toBe(true);
    expect(existsSync(join(outDir, "bericht.csv"))).toBe(false);
  }, 60_000);

  test("fehlschlagende Prüfung liefert Exitcode 1", () => {
    addTask({ id: "falsch", name: "Falsch", steps: [rowCount("c1", 99)] });
    const result = cli(["--run-task", "Falsch"]);
    expect(result.status, result.stderr).toBe(1);
    expect(runs("falsch")).toMatchObject([{ status: "failed" }]);
  }, 60_000);

  test("zweiter Aufruf während eines Laufs liefert Exitcode 5", async () => {
    addTask({
      id: "warten",
      name: "Warten",
      steps: [{ id: "w1", name: "Warten", action: { type: "wait", seconds: 4 } }],
    });
    const first = spawn(BIN, ["--run-task", "Warten", "--quiet"], { env: env() });
    const exited = new Promise<number | null>((resolve) => first.on("exit", resolve));
    const deadline = Date.now() + 15_000;
    while (!runs("warten").some((run) => run.status === "running")) {
      if (Date.now() > deadline) throw new Error("Erster Lauf startet nicht.");
      await Bun.sleep(100);
    }
    const second = cli(["--run-task", "Warten"]);
    expect(second.status, second.stderr).toBe(5);
    expect(await exited).toBe(0);
  }, 60_000);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test(`${signal} bricht den Lauf mit Exitcode 8 ab`, async () => {
      const id = `abbruch-${signal.toLowerCase()}`;
      addTask({
        id,
        name: `Abbruch ${signal}`,
        steps: [{ id: "w1", name: "Warten", action: { type: "wait", seconds: 30 } }],
      });
      const child = spawn(BIN, ["--run-task", `Abbruch ${signal}`], { env: env() });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
      const deadline = Date.now() + 15_000;
      while (!runs(id).some((run) => run.status === "running")) {
        if (Date.now() > deadline) throw new Error("Lauf startet nicht.");
        await Bun.sleep(100);
      }
      child.kill(signal);
      expect(await exited, stderr).toBe(8);
      expect(runs(id)[0]?.status).toBe("cancelled");
    }, 60_000);
  }

  test("ausgelöster Alarm liefert Exitcode 10", () => {
    addTask({
      id: "alarm",
      name: "Alarm",
      steps: [
        {
          id: "a1",
          name: "Offene Bestellungen",
          action: {
            type: "alert",
            connection: "conn-data",
            sql: "SELECT id FROM orders WHERE status = 'open'",
            condition: { type: "has_rows" },
          },
        },
      ],
    });
    const result = cli(["--run-task", "Alarm"]);
    expect(result.status, result.stderr).toBe(10);
    expect(runs("alarm")).toMatchObject([{ status: "success" }]);
  }, 60_000);

  test("--automation-tick überspringt bei laufender App", () => {
    addTask(
      {
        id: "hintergrund",
        name: "Hintergrund",
        background: true,
        schedules: [{ id: "minuetlich", trigger: { type: "interval", every: 1, unit: "minutes" } }],
        steps: [sql("m1", "INSERT INTO marker VALUES (datetime('now'))")],
      },
      new Date(Date.now() - 30_000).toISOString(),
    );
    setting("app_heartbeat", { at: new Date().toISOString(), pid: 1 });
    const result = cli(["--automation-tick", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ appRunning: true, started: [] });
    expect(runs("hintergrund")).toEqual([]);
  }, 60_000);

  test("--automation-tick führt fälligen Hintergrund-Task aus", () => {
    addTask(
      {
        id: "hintergrund",
        name: "Hintergrund",
        background: true,
        schedules: [{ id: "minuetlich", trigger: { type: "interval", every: 1, unit: "minutes" } }],
        steps: [sql("m1", "INSERT INTO marker VALUES (datetime('now'))")],
      },
      new Date(Date.now() - 30_000).toISOString(),
    );
    addTask(
      {
        id: "vordergrund",
        name: "Vordergrund",
        schedules: [{ id: "minuetlich", trigger: { type: "interval", every: 1, unit: "minutes" } }],
        steps: [sql("m1", "INSERT INTO marker VALUES ('vorne')")],
      },
      new Date(Date.now() - 30_000).toISOString(),
    );
    const result = cli(["--automation-tick", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.appRunning).toBe(false);
    expect(report.started).toHaveLength(1);
    expect(runs("hintergrund")).toMatchObject([{ status: "success", trigger: "background" }]);
    expect(runs("vordergrund")).toEqual([]);
    const data = new Database(dataPath, { readonly: true });
    expect((data.query("SELECT COUNT(*) AS n FROM marker").get() as { n: number }).n).toBe(1);
    data.close();
    const db = new Database(storePath);
    const tick = db.query("SELECT json FROM settings WHERE key = 'last_tick'").get() as {
      json: string;
    };
    db.close();
    expect(JSON.parse(tick.json).at).toMatch(/Z$/);
  }, 60_000);
});
