import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E = process.env.L8DB_CLI_E2E === "1";
const BIN = process.env.L8DB_BIN ?? join(import.meta.dir, "../src-tauri/target/debug/l8db");
const PG = process.env.L8DB_CLI_E2E_PG ?? "";
const PG_PERF = process.env.L8DB_CLI_E2E_PG_PERF ?? "";

setDefaultTimeout(300_000);

let dir = "";
let sqlitePath = "";

function env(extra: Record<string, string> = {}) {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !key.startsWith("L8DB_")) base[key] = value;
  return {
    ...base,
    L8DB_AUTOMATION_DB: join(dir, "automation.db"),
    L8DB_CLI_CONFIG: join(dir, "cli.json"),
    L8DB_DEV_SECRETS: join(dir, "secrets.json"),
    ...extra,
  };
}

function cli(args: string[], options: { input?: string; env?: Record<string, string> } = {}) {
  const result = spawnSync(BIN, args, {
    env: env(options.env),
    encoding: "utf8",
    input: options.input ?? "",
    timeout: 60_000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const PTY = `
import fcntl, os, pty, select, struct, sys, termios, time
argv, text = sys.argv[2:], sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
time.sleep(0.8)
if text:
    os.write(fd, text.encode())
out = b""
while True:
    ready, _, _ = select.select([fd], [], [], 30)
    if not ready:
        break
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode("utf-8", "replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;

function tty(args: string[], input: string) {
  const result = spawnSync("python3", ["-c", PTY, input, BIN, ...args], {
    env: env(),
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: result.status, out: result.stdout };
}

function saveConnections(connections: Record<string, unknown>[]) {
  const db = new Database(join(dir, "automation.db"));
  db.run("DELETE FROM connections");
  const now = new Date().toISOString();
  for (const connection of connections)
    db.run("INSERT INTO connections (id, json, updated_at) VALUES (?, ?, ?)", [
      connection.id as string,
      JSON.stringify(connection),
      now,
    ]);
  db.close();
}

function connection(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    kind: "sqlite",
    connectionString: sqlitePath,
    readOnly: false,
    environment: null,
    tags: [],
    ssh: null,
    proxy: null,
    commandTunnel: null,
    vault: false,
    ...extra,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

describe.skipIf(!E2E || !existsSync(BIN))("l8db CLI end-to-end", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "l8db-cli-"));
    sqlitePath = join(dir, "shop.sqlite");
    const db = new Database(sqlitePath);
    db.run("CREATE TABLE kunde (id INTEGER PRIMARY KEY, name TEXT, ort TEXT, notiz TEXT)");
    const insert = db.prepare("INSERT INTO kunde (name, ort, notiz) VALUES (?, ?, ?)");
    for (let i = 1; i <= 250; i++)
      insert.run(
        `Kunde ${i}`,
        i % 2 ? "Berlin" : "Köln",
        i === 3 ? 'mit "Komma", und\nZeile' : null,
      );
    db.close();
    expect(cli(["conn", "list"]).code).toBe(0);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("help is German, grouped and lists examples", () => {
    const help = cli(["--help"]);
    expect(help.code).toBe(0);
    for (const word of ["Verbindungen", "Daten", "Beispiele", "conn use <name>", "--output"])
      expect(help.out).toContain(word);
    const sub = cli(["table", "rows", "--help"]);
    expect(sub.out).toContain("Argumente:");
    expect(sub.out).toContain("(Standard: 100)");
    expect(sub.out).not.toContain("Options:");
    expect(cli(["help", "query"]).out).toContain("l8db query [SQL]");
  });

  test("typos get a suggestion and usage errors exit with 2", () => {
    const typo = cli(["quer"]);
    expect(typo.code).toBe(2);
    expect(typo.err).toContain("Meintest du „query“?");
    const missing = cli(["table", "rows"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Es fehlt: <TABELLE>");
  });

  test("empty store explains how to get connections", () => {
    const result = cli(["q", "select 1"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Öffne l8db einmal");
  });

  test("--url works without saved connections in every format", () => {
    const url = ["--url", sqlitePath];
    const tsv = cli([...url, "q", "select id, name from kunde order by id limit 2"]);
    expect(tsv.code).toBe(0);
    expect(tsv.out).toBe("id\tname\n1\tKunde 1\n2\tKunde 2\n");
    const json = JSON.parse(
      cli([...url, "-o", "json", "q", "select id, notiz from kunde where id = 3"]).out,
    );
    expect(json).toEqual([{ id: 3, notiz: 'mit "Komma", und\nZeile' }]);
    const csv = cli([
      ...url,
      "-o",
      "csv",
      "q",
      "select id, notiz from kunde where id in (2,3) order by id",
    ]);
    expect(csv.out).toBe('id,notiz\n2,\n3,"mit ""Komma"", und\nZeile"\n');
    const ndjson = cli([...url, "-o", "ndjson", "q", "select id from kunde order by id limit 2"]);
    expect(ndjson.out).toBe('{"id":1}\n{"id":2}\n');
    const piped = cli([...url, "q"], { input: "select count(*) as n from kunde" });
    expect(piped.out).toBe("n\n250\n");
    const viaEnv = cli(["q", "select 7 as x"], { env: { L8DB_URL: sqlitePath } });
    expect(viaEnv.out).toBe("x\n7\n");
  });

  test("table commands find, describe, page and count", () => {
    const url = ["--url", sqlitePath];
    expect(cli([...url, "table", "list"]).out).toContain("kunde");
    const describe = cli([...url, "table", "describe", "KUNDE"]);
    expect(describe.code).toBe(0);
    expect(describe.out).toContain("name");
    const rows = cli([
      ...url,
      "table",
      "rows",
      "kunde",
      "--where",
      "ort = 'Köln'",
      "--order-by",
      "id",
      "--desc",
      "-n",
      "2",
    ]);
    expect(rows.out.trim().split("\n").length).toBe(3);
    expect(rows.out).toContain("Kunde 250");
    expect(cli([...url, "table", "count", "kunde", "--where", "ort = 'Berlin'"]).out).toBe("125\n");
    const missing = cli([...url, "table", "rows", "kunden"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("l8db table list");
  });

  test("result limits are explicit", () => {
    const limited = cli(["--url", sqlitePath, "q", "-n", "5", "select * from kunde"]);
    expect(limited.out.trim().split("\n").length).toBe(6);
    expect(limited.err).toContain("Nur die ersten 5 Zeilen");
    const all = cli(["--url", sqlitePath, "q", "--all", "select * from kunde"]);
    expect(all.out.trim().split("\n").length).toBe(251);
    expect(all.err).not.toContain("Nur die ersten");
  });

  test("terminal output defaults to a table", () => {
    const result = tty(["--url", sqlitePath, "q", "select id, name from kunde limit 1"], "");
    expect(result.out).toContain("│ id ┆ name");
    expect(result.out).toContain("(1 Zeile");
  });

  test("saved connections: list, default, suggestions, env and -c", () => {
    saveConnections([
      connection("c-shop", "Shop", { tags: ["kunde"] }),
      connection("c-prod", "Produktion", { environment: "production" }),
      connection("c-ro", "Archiv", { readOnly: true }),
    ]);
    const ambiguous = cli(["q", "select 1"]);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain("Welche Verbindung?");
    expect(ambiguous.err).toContain("Archiv, Produktion, Shop");
    const list = cli(["conn", "list", "-o", "json"]);
    expect(JSON.parse(list.out).map((c: { name: string }) => c.name)).toEqual([
      "Archiv",
      "Produktion",
      "Shop",
    ]);
    expect(cli(["conn", "use", "shp"]).err).toContain("Meintest du „Shop“?");
    expect(cli(["conn", "use", "shop"]).code).toBe(0);
    expect(cli(["q", "select count(*) as n from kunde"]).out).toBe("n\n250\n");
    expect(cli(["conn", "list"]).out).toMatch(/\*\tShop/);
    expect(cli(["conn", "show", "-o", "json"]).out).toContain('"default": true');
    expect(cli(["-c", "Archiv", "q", "select 1 as a"]).out).toBe("a\n1\n");
    expect(cli(["q", "select 2 as b"], { env: { L8DB_CONNECTION: "Archiv" } }).out).toBe("b\n2\n");
    const test = cli(["conn", "test"]);
    expect(test.code).toBe(0);
    expect(test.err).toContain("✓ Verbunden mit „Shop“");
    expect(cli(["conn", "use", "--clear"]).code).toBe(0);
    expect(cli(["q", "select 1"]).code).toBe(1);
  });

  test("read-only connections refuse writes before connecting", () => {
    const result = cli(["-c", "Archiv", "q", "delete from kunde"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("schreibgeschützt");
    expect(cli(["-c", "Archiv", "q", "select count(*) from kunde"]).out).toContain("250");
  });

  test("production writes need confirmation", () => {
    const blocked = cli(["-c", "Produktion", "q", "update kunde set ort = 'X' where id = 1"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("--yes");
    const wrong = tty(
      ["-c", "Produktion", "q", "update kunde set ort = 'X' where id = 1"],
      "nein\n",
    );
    expect(wrong.out).toContain("Nicht bestätigt");
    expect(wrong.code).toBe(1);
    const typed = tty(
      ["-c", "Produktion", "q", "update kunde set ort = 'Y' where id = 1"],
      "Produktion\n",
    );
    expect(typed.out).toContain("Verbindungsnamen eintippen");
    expect(typed.out).toContain("1 Zeile geändert");
    expect(typed.code).toBe(0);
    const yes = cli([
      "-c",
      "Produktion",
      "q",
      "--yes",
      "update kunde set ort = 'Berlin' where id = 1",
    ]);
    expect(yes.code).toBe(0);
    expect(cli(["-c", "Produktion", "q", "select ort from kunde where id = 1"]).out).toBe(
      "ort\nBerlin\n",
    );
  });

  test("scripts stop at the first error", () => {
    const file = join(dir, "skript.sql");
    writeFileSync(file, "insert into kunde (name) values ('Neu');\nselect * from fehlt;\n");
    const result = cli(["-c", "Shop", "q", "-f", file]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Anweisung 2 von 2");
  });

  test.skipIf(!PG)("postgres: lists, transaction rollback and server read-only", () => {
    const url = ["--url", PG];
    expect(cli([...url, "db", "list"]).out).toContain("postgres");
    expect(cli([...url, "schema", "list"]).out).toContain("public");
    const file = join(dir, "pg.sql");
    writeFileSync(
      file,
      "create table if not exists cli_e2e (id int);\ninsert into cli_e2e values (1);\nselect * from gibt_es_nicht;\n",
    );
    const failed = cli([...url, "q", "-f", file]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("zurückgerollt");
    const exists = cli([
      ...url,
      "q",
      "select count(*) as n from pg_tables where tablename = 'cli_e2e'",
    ]);
    expect(exists.out).toBe("n\n0\n");
    writeFileSync(
      file,
      "create temp table t (id int);\ninsert into t values (1),(2);\nselect count(*) as n from t;\n",
    );
    const ok = cli([...url, "q", "-f", file]);
    expect(ok.code).toBe(0);
    expect(ok.out).toBe("n\n2\n");
    expect(ok.err).toContain("in einer Transaktion übernommen");
    saveConnections([
      connection("pg-ro", "PG lesend", {
        kind: "postgres",
        connectionString: `${PG}${PG.includes("?") ? "&" : "?"}options=-c%20default_transaction_read_only%3Don`,
        readOnly: false,
      }),
    ]);
    const blocked = cli(["-c", "PG lesend", "q", "create table nope (id int)"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("read-only");
    expect(cli(["-c", "PG lesend", "q", "select count(*) as n from kunde"]).out).toBe("n\n500\n");
    const page = cli(["--url", PG, "q", "-n", "3", "select id from kunde order by id"]);
    expect(page.out.trim().split("\n").length).toBe(4);
    expect(page.err).toContain("Nur die ersten 3 Zeilen");
    const broken = cli(["--url", PG, "q", "-n", "3", "select * from gibt_es_nicht"]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("gibt_es_nicht");
  });

  test.skipIf(!PG)("postgres: Ctrl+C cancels the running statement on the server", async () => {
    const child = spawn(BIN, ["--url", PG, "q", "select pg_sleep(30), 'cli-cancel-probe'"], {
      env: env(),
    });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const started = performance.now();
    child.kill("SIGINT");
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(code).toBe(130);
    expect(err).toContain("Abgebrochen");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const running = cli([
      "--url",
      PG,
      "q",
      "select count(*) as n from pg_stat_activity where query like '%cli-cancel-probe%' and pid <> pg_backend_pid()",
    ]);
    expect(running.out).toBe("n\n0\n");
  });

  test.skipIf(!PG_PERF)("performance: limits bound the fetch on a 2M-row table", () => {
    const url = ["--url", PG_PERF];
    const timings: number[] = [];
    for (let run = 0; run < 7; run++) {
      const started = performance.now();
      const result = cli([...url, "q", "-n", "100", "select * from big"]);
      timings.push(performance.now() - started);
      expect(result.code).toBe(0);
      expect(result.out.trim().split("\n").length).toBe(101);
    }
    const rows: number[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      cli([...url, "table", "rows", "big", "-n", "50"]);
      rows.push(performance.now() - started);
    }
    console.log(
      `query -n 100 on 2M rows: median ${median(timings).toFixed(0)} ms, p95 ${p95(timings).toFixed(0)} ms; table rows -n 50: median ${median(rows).toFixed(0)} ms, p95 ${p95(rows).toFixed(0)} ms`,
    );
    expect(median(timings)).toBeLessThan(500);
    expect(p95(timings)).toBeLessThan(1000);
    expect(median(rows)).toBeLessThan(1000);
    const mac = process.platform === "darwin";
    const memory = spawnSync(
      "/usr/bin/time",
      [
        mac ? "-l" : "-v",
        BIN,
        "--url",
        PG_PERF,
        "q",
        "-n",
        "1000",
        "-o",
        "csv",
        "select * from big",
      ],
      { env: env(), encoding: "utf8", timeout: 60_000 },
    );
    const peak = mac
      ? Number(/(\d+)\s+maximum resident set size/.exec(memory.stderr)?.[1] ?? 0)
      : Number(/Maximum resident set size \(kbytes\):\s*(\d+)/.exec(memory.stderr)?.[1] ?? 0) *
        1024;
    console.log(`query -n 1000 on 2M rows: peak RSS ${(peak / 1024 / 1024).toFixed(1)} MB`);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(150 * 1024 * 1024);
  });
});
