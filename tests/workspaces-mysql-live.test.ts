import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { SQL } from "bun";

const binary = process.env.L8DB_WORKSPACE_SERVER_BIN;
const mysqlUrl = process.env.L8DB_WORKSPACE_MYSQL_URL ?? process.env.MYSQL_URL;
const password = "workspace-mysql-local-test-password";
const email = "admin@workspace-mysql.test";

type Body = Record<string, unknown>;
type Session = { token: string; user: { id: string } };
type Page<T> = { items: T[]; more: boolean };
type QueryResult = { rows: Body[]; truncated: boolean };
type Server = { endpoint: string; stop: () => Promise<void> };

async function deadline<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function startServer(root: string, bootstrap: boolean): Promise<Server> {
  if (!binary || !isAbsolute(binary)) throw new Error("Absolutes L8DB_WORKSPACE_SERVER_BIN fehlt");
  const env = { ...process.env };
  delete env.L8DB_WORKSPACE_ADMIN_EMAIL;
  delete env.L8DB_WORKSPACE_ADMIN_PASSWORD;
  if (bootstrap) {
    env.L8DB_WORKSPACE_ADMIN_EMAIL = email;
    env.L8DB_WORKSPACE_ADMIN_PASSWORD = password;
  }
  const child = Bun.spawn(
    [binary, "--workspace-server", "--listen", "127.0.0.1:0", "--data", root],
    { env, stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  let ready: (endpoint: string) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const endpointPromise = new Promise<string>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const drained = (async () => {
    const decoder = new TextDecoder();
    let tail = "";
    for await (const chunk of child.stderr) {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-8192);
      const address = /Workspace läuft auf (127\.0\.0\.1:\d+)/.exec(tail)?.[1];
      if (address) ready(`http://${address}`);
    }
  })().catch(() => rejectReady(new Error("Workspace-Startausgabe wurde unterbrochen")));
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGINT");
    try {
      await deadline(child.exited, 5000, "Workspace beendet sich nicht");
    } catch {
      child.kill("SIGKILL");
      await child.exited;
    }
    await drained;
  };
  try {
    const endpoint = await deadline(
      Promise.race([
        endpointPromise,
        child.exited.then((code) => {
          throw new Error(`Workspace wurde vor dem Start beendet (Exit ${code})`);
        }),
      ]),
      20000,
      "Workspace-Server startet nicht innerhalb von 20 Sekunden",
    );
    const response = await fetch(`${endpoint}/health`);
    expect(response.ok).toBe(true);
    return { endpoint, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

test.skipIf(!binary || !mysqlUrl)(
  "native workspace server persists MySQL connections and enforces real read-only access, limits and idle budgets",
  async () => {
    if (!mysqlUrl) throw new Error("Lokale MYSQL_URL fehlt");
    const configured = new URL(mysqlUrl);
    if (
      configured.protocol !== "mysql:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(configured.hostname)
    )
      throw new Error("Dieser Test akzeptiert ausschließlich ein lokales MySQL-Lab");
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const schema = `l8db_workspace_${suffix}`;
    const sourceUser = `l8db_ws_${suffix}`;
    const sourcePassword = `lab_${crypto.randomUUID().replaceAll("-", "")}`;
    const source = new URL(configured);
    source.username = sourceUser;
    source.password = sourcePassword;
    source.pathname = `/${schema}`;
    const sourceUrl = source.toString();
    const db = new SQL(mysqlUrl, { max: 3 });
    const root = await mkdtemp(join(tmpdir(), "l8db-workspace-mysql-"));
    let server: Server | undefined;
    let requests = 0;
    const api = async <T>(token: string | null, method: string, path: string, body?: Body) => {
      if (!server) throw new Error("Workspace-Server fehlt");
      const url = new URL(`/api/${path}`, server.endpoint);
      if (method === "GET" && body)
        for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value));
      requests++;
      const response = await fetch(url, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body && method !== "GET" ? { "Content-Type": "application/json" } : {}),
        },
        body: body && method !== "GET" ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(35000),
      });
      const raw = await response.text();
      expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(!raw.includes(sourceUrl)).toBe(true);
      expect(!raw.includes(sourcePassword)).toBe(true);
      return {
        status: response.status,
        value: JSON.parse(raw) as T,
        bytes: Buffer.byteLength(raw),
      };
    };
    const ok = async <T>(token: string | null, method: string, path: string, body?: Body) => {
      const reply = await api<T>(token, method, path, body);
      if (reply.status < 200 || reply.status >= 300)
        throw new Error(
          `Workspace ${method} ${path}: HTTP ${reply.status} ${JSON.stringify(reply.value)}`,
        );
      return reply.value;
    };
    const sourceStats = async () => {
      const [row] =
        await db`SELECT COALESCE(SUM(COUNT_STAR),0) AS total, COALESCE(SUM(SUM_ROWS_SENT),0) AS sent FROM performance_schema.events_statements_summary_by_account_by_event_name WHERE USER=${sourceUser} AND EVENT_NAME LIKE 'statement/sql/%'`;
      return { statements: Number(row.total), rowsSent: Number(row.sent) };
    };
    const sourceQueries = async () => {
      const [row] =
        await db`SELECT COUNT(*) AS total FROM information_schema.PROCESSLIST WHERE USER=${sourceUser} AND DB=${schema} AND COMMAND='Query'`;
      return Number(row.total);
    };
    try {
      const [settings] = await db.unsafe("SELECT @@performance_schema AS enabled");
      expect(Number(settings.enabled)).toBe(1);
      await db.unsafe(`CREATE DATABASE \`${schema}\``);
      await db.unsafe(`CREATE USER '${sourceUser}'@'%' IDENTIFIED BY '${sourcePassword}'`);
      await db.unsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,EXECUTE ON \`${schema}\`.* TO '${sourceUser}'@'%'`,
      );
      await db.unsafe(
        `CREATE TABLE \`${schema}\`.items(id INTEGER PRIMARY KEY, label VARCHAR(64))`,
      );
      for (let start = 1; start <= 10000; start += 1000) {
        const values = Array.from(
          { length: 1000 },
          (_, index) => `(${start + index},'row_${start + index}')`,
        ).join(",");
        await db.unsafe(`INSERT INTO \`${schema}\`.items VALUES ${values}`);
      }
      await db.unsafe(
        `CREATE FUNCTION \`${schema}\`.mutate() RETURNS INTEGER DETERMINISTIC MODIFIES SQL DATA SQL SECURITY DEFINER BEGIN INSERT INTO \`${schema}\`.items VALUES(10001,'definer_write'); RETURN 1; END`,
      );
      server = await startServer(root, true);
      const admin = await ok<Session>(null, "POST", "login", { email, password });
      const invitation = await ok<{ token: string }>(admin.token, "POST", "invitations", {
        email: "reader@workspace-mysql.test",
        role: "member",
      });
      await ok(null, "POST", "invitations/accept", {
        email: "reader@workspace-mysql.test",
        password,
        token: invitation.token,
      });
      const reader = await ok<Session>(null, "POST", "login", {
        email: "reader@workspace-mysql.test",
        password,
      });
      const connection = await ok<{ id: string }>(admin.token, "POST", "connections", {
        name: "MySQL live",
        kind: "mysql",
        database: schema,
        connectionString: sourceUrl,
      });
      const path = `connections/${connection.id}`;
      expect((await api(reader.token, "POST", `${path}/query`, { sql: "SELECT 1" })).status).toBe(
        403,
      );
      await ok(admin.token, "PUT", `${path}/grants`, { userId: reader.user.id, access: "read" });
      const count = await ok<QueryResult>(reader.token, "POST", `${path}/query`, {
        sql: "SELECT COUNT(*) AS total FROM items",
      });
      expect(Number(count.rows[0]?.total)).toBe(10000);
      expect(
        (
          await api(reader.token, "POST", `${path}/query`, {
            sql: "INSERT INTO items VALUES(10001,'forbidden')",
          })
        ).status,
      ).toBe(403);
      const definer = await api<{ error: string }>(reader.token, "POST", `${path}/query`, {
        sql: `SELECT \`${schema}\`.mutate() AS result`,
      });
      expect(definer.status).toBeGreaterThanOrEqual(400);
      expect(definer.value.error).toMatch(/read.only|read only|readonly|1792|lese/i);
      const [unchanged] = await db.unsafe(`SELECT COUNT(*) AS total FROM \`${schema}\`.items`);
      expect(Number(unchanged.total)).toBe(10000);
      await ok(admin.token, "POST", `${path}/query`, {
        sql: "INSERT INTO items VALUES(10001,'admin_write')",
      });
      const [written] = await db.unsafe(`SELECT COUNT(*) AS total FROM \`${schema}\`.items`);
      expect(Number(written.total)).toBe(10001);
      await ok(admin.token, "POST", `${path}/query`, { sql: "DELETE FROM items WHERE id=10001" });
      const page = await ok<QueryResult>(reader.token, "POST", `${path}/metadata`, {
        operation: "rows",
        schema,
        table: "items",
        orderBy: "id",
        limit: 100,
        offset: 200,
      });
      expect(page.rows).toHaveLength(100);
      expect(Number(page.rows[0]?.id)).toBe(201);
      const bounded = await ok<QueryResult>(reader.token, "POST", `${path}/query`, {
        sql: "SELECT id,label FROM items ORDER BY id",
      });
      expect(bounded.rows).toHaveLength(1000);
      expect(bounded.truncated).toBe(true);
      const large = await api<{ error: string }>(reader.token, "POST", `${path}/query`, {
        sql: "SELECT REPEAT('x',4200000) AS payload",
      });
      expect(large.status).toBeGreaterThanOrEqual(400);
      expect(large.value.error).toContain("4 MB");
      for (let index = 0; index < 100; index++)
        await ok(admin.token, "POST", "connections", {
          name: `Additional ${String(index).padStart(3, "0")}`,
          kind: "mysql",
          database: schema,
          connectionString: sourceUrl,
        });
      const first = await ok<Page<{ id: string }>>(admin.token, "GET", "connections", {
        offset: 0,
      });
      const last = await ok<Page<{ id: string }>>(admin.token, "GET", "connections", {
        offset: 100,
      });
      expect(first.items).toHaveLength(100);
      expect(first.more).toBe(true);
      expect(last.items).toHaveLength(1);
      expect(last.more).toBe(false);
      const readerList = await ok<Page<{ id: string }>>(reader.token, "GET", "connections");
      expect(readerList.items.map((item) => item.id)).toEqual([connection.id]);
      const stored = new Database(join(root, "workspace.sqlite"), { readonly: true });
      try {
        const encrypted = stored
          .query("SELECT credentials FROM connections WHERE id=?")
          .get(connection.id) as { credentials: string };
        expect(!encrypted.credentials.includes(sourcePassword)).toBe(true);
        expect(!encrypted.credentials.includes(sourceUrl)).toBe(true);
      } finally {
        stored.close();
      }
      if (process.platform !== "win32") {
        expect((await stat(root)).mode & 0o777).toBe(0o700);
        expect((await stat(join(root, "credentials.key"))).mode & 0o777).toBe(0o600);
      }
      expect(Bun.file(join(root, "credentials.key")).size).toBe(32);
      await server.stop();
      server = await startServer(root, false);
      const persisted = await ok<QueryResult>(reader.token, "POST", `${path}/query`, {
        sql: "SELECT COUNT(*) AS total FROM items",
      });
      expect(Number(persisted.rows[0]?.total)).toBe(10000);
      const samples: number[] = [];
      const calls = requests;
      const statsBefore = await sourceStats();
      let retainedBytes = 0;
      for (let run = 0; run < 15; run++) {
        const start = performance.now();
        const result = await api<QueryResult>(reader.token, "POST", `${path}/query`, {
          sql: "SELECT id,label FROM items ORDER BY id",
        });
        samples.push(performance.now() - start);
        expect(result.status).toBe(200);
        expect(result.value.rows).toHaveLength(1000);
        expect(Number(result.value.rows[0]?.id)).toBe(1);
        expect(Number(result.value.rows.at(-1)?.id)).toBe(1000);
        expect(result.value.truncated).toBe(true);
        retainedBytes = Math.max(retainedBytes, result.bytes);
      }
      const statsAfter = await sourceStats();
      const sourceReads = statsAfter.statements - statsBefore.statements;
      const sourceRows = statsAfter.rowsSent - statsBefore.rowsSent;
      samples.sort((a, b) => a - b);
      expect(requests - calls).toBe(15);
      expect(sourceReads).toBeGreaterThanOrEqual(15);
      expect(sourceReads).toBeLessThanOrEqual(15 * 8);
      expect(sourceRows).toBeGreaterThanOrEqual(15 * 1000);
      expect(sourceRows).toBeLessThanOrEqual(15 * (10000 + 8));
      expect(retainedBytes).toBeLessThan(128 * 1024);
      expect(samples[7]).toBeLessThan(100);
      expect(samples[14]).toBeLessThan(250);
      const locker = await db.reserve();
      let remainingAtCancellation = 0;
      let cancelMilliseconds = 0;
      let jobs: Array<Promise<{ status: number }>> = [];
      let finished: Promise<PromiseSettledResult<{ status: number }>[]> | undefined;
      try {
        await locker.unsafe(`LOCK TABLES \`${schema}\`.items WRITE`);
        jobs = Array.from({ length: 4 }, (_, index) =>
          api(reader.token, "POST", `${path}/query`, {
            sql: "SELECT COUNT(*) AS total FROM items",
            jobId: `mysql-concurrency-${index}`,
          }),
        );
        finished = Promise.allSettled(jobs);
        const waitingUntil = performance.now() + 5000;
        while ((await sourceQueries()) < 4 && performance.now() < waitingUntil) await Bun.sleep(10);
        expect(await sourceQueries()).toBe(4);
        expect(
          (
            await api(reader.token, "POST", `${path}/query`, {
              sql: "SELECT 1",
              jobId: "mysql-fifth",
            })
          ).status,
        ).toBe(429);
        const started = performance.now();
        await ok(reader.token, "POST", `${path}/cancel`, { jobId: "mysql-concurrency-0" });
        expect(
          (await deadline(jobs[0], 2000, "HTTP-Abbruch bleibt blockiert")).status,
        ).toBeGreaterThanOrEqual(400);
        cancelMilliseconds = performance.now() - started;
        remainingAtCancellation = await sourceQueries();
        for (let index = 1; index < 4; index++)
          await ok(reader.token, "POST", `${path}/cancel`, { jobId: `mysql-concurrency-${index}` });
      } finally {
        await locker.unsafe("UNLOCK TABLES");
        locker.release();
        if (finished) await deadline(finished, 5000, "MySQL-Jobs kehren nach Unlock nicht zurück");
      }
      const idleUntil = performance.now() + 3000;
      while ((await sourceQueries()) !== 0 && performance.now() < idleUntil) await Bun.sleep(10);
      expect(await sourceQueries()).toBe(0);
      expect(
        (await ok<QueryResult>(reader.token, "POST", `${path}/query`, { sql: "SELECT 1 AS alive" }))
          .rows[0]?.alive,
      ).toBe(1);
      const auditBefore = await ok<Page<{ id: number; action: string }>>(
        admin.token,
        "GET",
        "logs",
      );
      expect(auditBefore.items.some((item) => item.action === "query.execute")).toBe(true);
      const idleCalls = requests;
      const idleStats = await sourceStats();
      await Bun.sleep(250);
      expect(requests).toBe(idleCalls);
      expect(await sourceStats()).toEqual(idleStats);
      const auditAfter = await ok<Page<{ id: number }>>(admin.token, "GET", "logs");
      expect(auditAfter.items.map((item) => item.id)).toEqual(
        auditBefore.items.map((item) => item.id),
      );
      console.log(
        `workspace MySQL native: 10000 rows, median ${samples[7].toFixed(2)} ms p95 ${samples[14].toFixed(2)} ms (limits100/250), 15 HTTP queries/${sourceReads} source SQL statements/${sourceRows} source rows, retained1000 rows/response${retainedBytes}B, concurrency4/fifth429; HTTP cancel${cancelMilliseconds.toFixed(2)}ms, source queries still present at cancellation${remainingAtCancellation} (no immediate server-cancel guarantee); after unlock0/idle requests0`,
      );
    } finally {
      await server?.stop();
      try {
        await db.unsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
        await db.unsafe(`DROP USER IF EXISTS '${sourceUser}'@'%'`);
      } finally {
        await db.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  180000,
);
