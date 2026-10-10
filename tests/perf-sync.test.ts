import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { autoSyncPlan, startAutoSync } from "../src/lib/sync/auto-sync";
import { runSync } from "../src/lib/sync/engine";
import { mergeSnapshots } from "../src/lib/sync/merge";
import {
  buildSnapshot,
  contentHash,
  documentSnapshot,
  type LocalCollections,
  parseEnvelope,
  type SyncDocument,
  snapshotBase,
  toDocument,
} from "../src/lib/sync/payload";
import {
  acceptAll,
  connection,
  device,
  emptyCollections,
  FakeCoordinator,
  FakeRemote,
  webdav,
} from "./fixtures/sync-fakes";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const CONNECTIONS = 2000;
const SAVED_QUERIES = 5000;
const HISTORY = 5000;
const SNIPPETS = 500;

function environment() {
  return {
    os: `${platform()} ${release()}`,
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    runtime: `bun ${Bun.version}`,
  };
}

function sql(index: number) {
  return `SELECT o.id, o.created_at, c.name, sum(l.amount) AS total FROM orders o JOIN customers c ON c.id = o.customer_id JOIN lines l ON l.order_id = o.id WHERE o.tenant_id = ${index} GROUP BY 1, 2, 3 ORDER BY total DESC LIMIT 100`;
}

function workload(): LocalCollections {
  const collections = emptyCollections();
  collections.connections = Array.from({ length: CONNECTIONS }, (_, index) =>
    connection(`conn-${index}`, `Server ${index}`, {
      ssh:
        index % 4 === 0
          ? {
              host: `bastion-${index}.example.com`,
              port: 22,
              user: "deploy",
              auth: "key",
              keyFile: "~/.ssh/id_ed25519",
              remoteHost: "10.0.0.5",
              remotePort: 5432,
            }
          : null,
      tags: [{ name: index % 2 ? "prod" : "dev", color: "#3b82f6" }],
      environment: index % 2 ? "production" : "development",
      maskRules: [{ name: "E-Mail", pattern: "email", enabled: true, mask: null }],
    }),
  );
  collections.hostGroupRules = Array.from({ length: 50 }, (_, index) => ({
    id: `rule-${index}`,
    data: { id: `rule-${index}`, name: `Gruppe ${index}`, pattern: `db-${index}*` },
  }));
  collections.connectionPrefs = [
    { id: "favoriteServerKeys", data: { value: ["a", "b"] } },
    { id: "serverOrder", data: { value: Array.from({ length: 200 }, (_, i) => `server-${i}`) } },
  ];
  collections.savedQueries = Array.from({ length: SAVED_QUERIES }, (_, index) => ({
    id: `saved-${index}`,
    data: { id: `saved-${index}`, name: `Abfrage ${index}`, sql: sql(index), createdAt: index },
  }));
  collections.snippets = Array.from({ length: SNIPPETS }, (_, index) => ({
    id: `snippet-${index}`,
    updatedAt: index,
    data: {
      id: `snippet-${index}`,
      name: `Snippet ${index}`,
      shortcut: `s${index}`,
      description: "Vorlage",
      category: "Allgemein",
      body: sql(index),
      createdAt: index,
      updatedAt: index,
    },
  }));
  collections.history = Array.from({ length: HISTORY }, (_, index) => ({
    id: `history-${index}`,
    updatedAt: index,
    data: {
      id: `history-${index}`,
      connectionId: `conn-${index % CONNECTIONS}`,
      database: "app",
      sql: sql(index),
      ranAt: index,
      durationMs: 12,
      rowCount: 100,
      error: null,
    },
  }));
  collections.workspace = [
    { id: "settings", data: { value: { rowLimit: 500, editorFontSize: 13 } } },
    { id: "hotkeys", data: { value: {} } },
    { id: "layouts", data: { value: {} } },
    { id: "profiles", data: { value: {} } },
    { id: "favorites", data: { value: [] } },
    { id: "views", data: { value: {} } },
  ];
  return collections;
}

function touch(collections: LocalCollections, every: number, suffix: string): LocalCollections {
  const next = { ...collections };
  next.savedQueries = next.savedQueries.map((item, index) =>
    index % every === 0
      ? { ...item, data: { ...(item.data as object), name: `Abfrage ${index} ${suffix}` } }
      : item,
  );
  return next;
}

async function objectCount() {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
  return heapStats().objectCount;
}

const settings = { includeHistory: true, includeSecrets: false, encryptAll: false };

test("Synchronisation bleibt bei 2000 Verbindungen, 5000 Abfragen und 5000 Verlaufseinträgen schnell und sparsam", async () => {
  const collections = workload();
  const now = 1_700_000_000_000;
  const snapshot = buildSnapshot(collections, new Map(), now);
  const base = snapshotBase(snapshot);
  let hash = "";
  let body = "";
  let parsedDocument: SyncDocument | null = null;

  const build = await measureScenario(() => {
    buildSnapshot(collections, base, now);
  }, 3);
  const fresh = (): LocalCollections =>
    Object.fromEntries(
      Object.entries(collections).map(([collection, items]) => [
        collection,
        items.map((item) => ({ ...item, data: { ...(item.data as object) } })),
      ]),
    ) as LocalCollections;
  const coldInputs = Array.from({ length: 5 }, fresh);
  const buildCold = await measureScenario(() => {
    buildSnapshot(coldInputs.pop() ?? fresh(), base, now);
  }, 3);
  const hashing = await measureScenario(async () => {
    hash = await contentHash(snapshot, null);
  }, 3);
  const serialize = await measureScenario(() => {
    body = JSON.stringify(
      toDocument(snapshot, { deviceId: "perf", updatedAt: now, contentHash: hash, secrets: null }),
    );
  }, 3);
  const parse = await measureScenario(() => {
    parsedDocument = parseEnvelope(body) as SyncDocument;
    documentSnapshot(parsedDocument);
  }, 3);
  const local = buildSnapshot(touch(collections, 100, "lokal"), base, now + 1);
  const remote = buildSnapshot(touch(collections, 97, "remote"), base, now + 2);
  let conflicts = 0;
  const merge = await measureScenario(() => {
    conflicts = mergeSnapshots(local, remote, base).conflicts.length;
  }, 3);
  const payloadBytes = new TextEncoder().encode(body).length;
  const items = CONNECTIONS + SAVED_QUERIES + HISTORY + SNIPPETS + 50 + 2 + 6;

  const remoteStore = new FakeRemote();
  const coordinator = new FakeCoordinator();
  const leader = device("main", remoteStore, coordinator);
  leader.collections = collections;
  const run = (mode: "sync" | "upload" = "sync", signal?: AbortSignal) =>
    runSync(leader.deps, {
      mode,
      target: webdav,
      settings,
      memory: { deviceId: "main", lastSalt: null },
      decider: acceptAll,
      signal,
    });

  const initialStart = performance.now();
  await run();
  const initialMs = performance.now() - initialStart;
  const initialRequests = { get: remoteStore.gets, put: remoteStore.puts };

  remoteStore.gets = 0;
  remoteStore.puts = 0;
  const objectsBefore = await objectCount();
  const steady = await measureScenario(async () => {
    await run();
  }, 3);
  const objectsAfter = await objectCount();
  const retainedObjects = Math.max(0, objectsAfter - objectsBefore);
  const steadyRequests = { get: remoteStore.gets, put: remoteStore.puts, runs: steady.runs + 2 };

  remoteStore.gets = 0;
  remoteStore.puts = 0;
  let round = 0;
  const changed = await measureScenario(async () => {
    round++;
    leader.collections = touch(collections, 250, `runde ${round}`);
    await run();
  }, 3);
  const changedRequests = { get: remoteStore.gets, put: remoteStore.puts, runs: changed.runs + 2 };

  leader.collections = collections;

  remoteStore.delayMs = 2000;
  remoteStore.gets = 0;
  remoteStore.puts = 0;
  const controller = new AbortController();
  const abandoned = run("sync", controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const abortStart = performance.now();
  controller.abort();
  const abortError = await abandoned.catch((error: Error) => error);
  const abortMs = performance.now() - abortStart;
  remoteStore.delayMs = 0;
  const cancellation = {
    abortMs,
    puts: remoteStore.puts,
    cancelled: remoteStore.cancelled.length,
    leaseReleased: coordinator.active === null,
  };

  const timers: (() => void)[] = [];
  const schedule = (callback: () => void) => timers.push(callback);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const idleRemote = new FakeRemote();
  const idleCoordinator = new FakeCoordinator();
  let leaderOwner: string | null = null;
  const claim = (label: string) => async () => {
    leaderOwner ??= label;
    return leaderOwner === label;
  };
  const idleLeader = device("main", idleRemote, idleCoordinator);
  idleLeader.collections = {
    ...emptyCollections(),
    savedQueries: collections.savedQueries.slice(0, 200),
  };
  await runSync(idleLeader.deps, {
    mode: "sync",
    target: webdav,
    settings,
    memory: { deviceId: "main", lastSalt: null },
    decider: acceptAll,
  });
  idleRemote.gets = 0;
  idleRemote.puts = 0;
  idleRemote.maxInFlight = 0;
  const follower = device("win-1", idleRemote, idleCoordinator);
  let followerRuns = 0;
  const stopLeader = startAutoSync({
    intervalMs: 15 * 60_000,
    syncOnStart: false,
    claim: claim("main"),
    release: async () => undefined,
    run: async (signal) => {
      await runSync(idleLeader.deps, {
        mode: "sync",
        target: webdav,
        settings,
        memory: { deviceId: "main", lastSalt: null },
        decider: acceptAll,
        signal,
      });
    },
    schedule,
    clear: () => undefined,
  });
  const stopFollower = startAutoSync({
    intervalMs: 15 * 60_000,
    syncOnStart: false,
    claim: claim("win-1"),
    release: async () => undefined,
    run: async () => {
      followerRuns++;
      await runSync(follower.deps, {
        mode: "sync",
        target: webdav,
        settings,
        memory: { deviceId: "win-1", lastSalt: null },
        decider: acceptAll,
      });
    },
    schedule,
    clear: () => undefined,
  });
  const ticksPerDay = 96;
  for (let tick = 0; tick < ticksPerDay; tick++) {
    const due = timers.splice(0, 2);
    for (const callback of due) callback();
    while (timers.length < 2) await settle();
  }
  const idle = {
    simulatedHours: 24,
    leaderGets: idleRemote.gets,
    puts: idleRemote.puts,
    followerRuns,
    maxInFlight: idleRemote.maxInFlight,
  };
  stopLeader();
  stopFollower();
  const pendingAfterStop = timers.length;
  for (const callback of timers.splice(0)) callback();
  await settle();
  const getsAfterStop = idleRemote.gets - idle.leaderGets;

  let disabledRequests = 0;
  const disabledTimers: unknown[] = [];
  const disabledPlan = autoSyncPlan({ autoSync: false, configured: true, intervalMinutes: 15 });
  if (disabledPlan)
    startAutoSync({
      intervalMs: disabledPlan.intervalMs,
      syncOnStart: true,
      claim: async () => true,
      release: async () => undefined,
      run: async () => {
        disabledRequests++;
      },
      schedule: (callback) => disabledTimers.push(callback),
    });

  reportScenario("sync-payload", {
    environment: environment(),
    workload: {
      connections: CONNECTIONS,
      savedQueries: SAVED_QUERIES,
      history: HISTORY,
      snippets: SNIPPETS,
      items,
    },
    buildSnapshot: build,
    buildSnapshotCold: buildCold,
    contentHash: hashing,
    serialize,
    parse,
    merge: { ...merge, conflicts },
    payloadBytes,
    bytesPerItem: Math.round(payloadBytes / items),
    initialSync: { ms: initialMs, ...initialRequests },
    steadySync: { ...steady, ...steadyRequests },
    changedSync: { ...changed, ...changedRequests },
    retainedObjectsAfter5Syncs: retainedObjects,
    cancellation,
    idle,
    pendingAfterStop,
    getsAfterStop,
    disabled: { requests: disabledRequests, timers: disabledTimers.length },
  });

  expect(initialRequests).toEqual({ get: 1, put: 1 });
  expect(steadyRequests.get).toBe(steadyRequests.runs);
  expect(steadyRequests.put).toBe(0);
  expect(changedRequests.get).toBe(changedRequests.runs);
  expect(changedRequests.put).toBe(changedRequests.runs);
  expect(conflicts).toBe(1);
  expect(build.p95Ms).toBeLessThan(100);
  expect(buildCold.p95Ms).toBeLessThan(400);
  expect(hashing.p95Ms).toBeLessThan(100);
  expect(serialize.p95Ms).toBeLessThan(150);
  expect(parse.p95Ms).toBeLessThan(450);
  expect(merge.p95Ms).toBeLessThan(100);
  expect(steady.p95Ms).toBeLessThan(1200);
  expect(changed.p95Ms).toBeLessThan(1500);
  expect(payloadBytes).toBeLessThan(8 * 1024 * 1024);
  expect(payloadBytes / items).toBeLessThan(700);
  expect(retainedObjects).toBeLessThan(1000);
  expect(abortError).toBeInstanceOf(Error);
  expect(cancellation).toMatchObject({ puts: 0, cancelled: 1, leaseReleased: true });
  expect(cancellation.abortMs).toBeLessThan(100);
  expect(idle).toMatchObject({ leaderGets: ticksPerDay, puts: 0, followerRuns: 0, maxInFlight: 1 });
  expect(getsAfterStop).toBe(0);
  expect(disabledRequests + disabledTimers.length).toBe(0);
}, 120_000);
