import { describe, expect, test } from "bun:test";
import { autoSyncPlan, backoffDelay, startAutoSync } from "../src/lib/sync/auto-sync";
import { runSync, SyncBusyError, SyncRemoteChangedError } from "../src/lib/sync/engine";
import { mergeSnapshots, resolveConflicts } from "../src/lib/sync/merge";
import {
  buildSnapshot,
  canonicalJson,
  contentHash,
  DELETED,
  devicePathHints,
  documentSnapshot,
  hashData,
  parseDocument,
  parseEnvelope,
  snapshotBase,
  TOMBSTONE_TTL_MS,
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

function nameOf(snapshot: { items: Map<string, { data: unknown }> }, key: string) {
  return (snapshot.items.get(key)?.data as { name?: string } | undefined)?.name;
}

const settings = { includeHistory: false, includeSecrets: false, encryptAll: false };

function sync(
  dev: ReturnType<typeof device>,
  mode: "sync" | "upload" | "download" = "sync",
  overrides: Partial<typeof settings> = {},
  decider = acceptAll,
  signal?: AbortSignal,
) {
  return runSync(dev.deps, {
    mode,
    target: webdav,
    settings: { ...settings, ...overrides },
    memory: { deviceId: dev.label, lastSalt: null },
    decider,
    signal,
  });
}

describe("payload", () => {
  test("canonical JSON and hashes are independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}',
    );
    expect(hashData({ a: 1, b: 2 })).toBe(hashData({ b: 2, a: 1 }));
    expect(hashData({ a: 1 })).not.toBe(hashData({ a: 2 }));
  });

  test("snapshots derive tombstones from the last synced base and expire them", () => {
    const now = 10 * TOMBSTONE_TTL_MS;
    const collections = emptyCollections();
    collections.savedQueries = [{ id: "q1", data: { id: "q1", name: "A", sql: "SELECT 1" } }];
    const base = new Map<string, [string, number]>([
      ["savedQueries:q1", [hashData(collections.savedQueries[0].data), 5]],
      ["savedQueries:gone", ["x", 5]],
      ["snippets:old", [DELETED, now - TOMBSTONE_TTL_MS - 1]],
      ["snippets:recent", [DELETED, now - 1000]],
    ]);
    const snapshot = buildSnapshot(collections, base, now);
    expect(snapshot.items.get("savedQueries:q1")?.updatedAt).toBe(5);
    expect(snapshot.tombstones.get("savedQueries:gone")).toBe(now);
    expect(snapshot.tombstones.has("snippets:old")).toBe(false);
    expect(snapshot.tombstones.get("snippets:recent")).toBe(now - 1000);
  });

  test("documents round-trip, are versioned and strip device-only connection fields", async () => {
    const collections = emptyCollections();
    collections.connections = [
      connection("c1", "Prod", {
        kind: "sqlite",
        connectionString: "/Users/leon/db.sqlite",
        ssh: { keyFile: "~/.ssh/id_ed25519", jumpHosts: [{ agentSocket: "/tmp/agent" }] },
      }),
    ];
    const snapshot = buildSnapshot(collections, new Map(), 1000);
    const hash = await contentHash(snapshot, null);
    const document = toDocument(snapshot, {
      deviceId: "dev-a",
      updatedAt: 1000,
      contentHash: hash,
      secrets: null,
    });
    expect(document).toMatchObject({ format: "l8db-sync", schemaVersion: 1, deviceId: "dev-a" });
    expect(document.hints.devicePaths.map((hint) => hint.field)).toEqual([
      "connectionString",
      "ssh.keyFile",
      "ssh.jumpHosts.0.agentSocket",
    ]);
    const tampered = JSON.parse(JSON.stringify(document));
    tampered.items.connections.c1.data.tunnelPort = 5555;
    tampered.items.connections.c1.data.temporary = true;
    tampered.items.connections.c1.data.commandTunnel = { command: "rm -rf ~" };
    tampered.items.connections.evil = { updatedAt: 1, data: { id: "other", name: "x" } };
    const parsed = parseDocument(JSON.stringify(tampered));
    expect(parsed.items.connections?.c1.data).not.toHaveProperty("tunnelPort");
    expect(parsed.items.connections?.c1.data).not.toHaveProperty("temporary");
    expect(parsed.items.connections?.c1.data).not.toHaveProperty("commandTunnel");
    expect(parsed.items.connections?.evil).toBeUndefined();
    expect(await contentHash(documentSnapshot(parsed), null)).toBe(hash);
    expect(() => parseEnvelope('{"format":"l8db-sync","schemaVersion":99}')).toThrow(
      "neueren l8db-Version",
    );
    expect(() =>
      parseEnvelope('{"format":"l8db-sync","schemaVersion":1,"__proto__":{"x":1}}'),
    ).toThrow("Ungültiger Schlüssel");
    expect(devicePathHints(snapshot)).toHaveLength(3);
    const quoted = JSON.parse(JSON.stringify(document));
    quoted.items.connections.c1.data.name = "SELECT '{\"constructor\": 1}'";
    expect(parseDocument(JSON.stringify(quoted)).items.connections?.c1.data).toMatchObject({
      name: "SELECT '{\"constructor\": 1}'",
    });
  });

  test("content hash changes with the secrets fingerprint only", async () => {
    const snapshot = buildSnapshot(emptyCollections(), new Map(), 1);
    expect(await contentHash(snapshot, "a")).not.toBe(await contentHash(snapshot, "b"));
    expect(await contentHash(snapshot, "a")).toBe(await contentHash(snapshot, "a"));
  });
});

describe("merge", () => {
  const entry = (name: string, updatedAt: number) => {
    const data = { id: "x", name, sql: name };
    return { hash: hashData(data), updatedAt, data };
  };
  const snap = (
    items: [string, ReturnType<typeof entry>][],
    tombstones: [string, number][] = [],
  ) => ({
    items: new Map(items),
    tombstones: new Map(tombstones),
  });

  test("one-sided changes merge without conflicts, including deletions", () => {
    const base = snapshotBase(
      snap([
        ["savedQueries:a", entry("A", 1)],
        ["savedQueries:b", entry("B", 1)],
      ]),
    );
    const local = snap([
      ["savedQueries:a", entry("A2", 5)],
      ["savedQueries:b", entry("B", 1)],
    ]);
    const remote = snap(
      [
        ["savedQueries:a", entry("A", 1)],
        ["savedQueries:c", entry("C", 3)],
      ],
      [["savedQueries:b", 4]],
    );
    const result = mergeSnapshots(local, remote, base);
    expect(result.conflicts).toEqual([]);
    expect(nameOf(result.merged, "savedQueries:a")).toBe("A2");
    expect(result.merged.items.has("savedQueries:b")).toBe(false);
    expect(result.merged.tombstones.get("savedQueries:b")).toBe(4);
    expect(result.merged.items.has("savedQueries:c")).toBe(true);
  });

  test("both sides changed is a conflict that strategies resolve", () => {
    const base = snapshotBase(
      snap([
        ["savedQueries:a", entry("A", 1)],
        ["savedQueries:d", entry("D", 1)],
      ]),
    );
    const local = snap([["savedQueries:a", entry("lokal", 9)]], [["savedQueries:d", 6]]);
    const remote = snap([
      ["savedQueries:a", entry("remote", 7)],
      ["savedQueries:d", entry("D2", 8)],
    ]);
    const result = mergeSnapshots(local, remote, base);
    expect(result.conflicts.map((conflict) => conflict.key).sort()).toEqual([
      "savedQueries:a",
      "savedQueries:d",
    ]);
    const keepLocal = resolveConflicts(result, "local");
    expect(nameOf(keepLocal, "savedQueries:a")).toBe("lokal");
    expect(keepLocal.tombstones.has("savedQueries:d")).toBe(true);
    const keepRemote = resolveConflicts(result, "remote");
    expect(nameOf(keepRemote, "savedQueries:a")).toBe("remote");
    expect(keepRemote.items.has("savedQueries:d")).toBe(true);
    const both = resolveConflicts(result, "both", 100);
    const copies = [...both.items.entries()].filter(([key]) => key.includes("-remote-"));
    expect(copies).toHaveLength(1);
    expect((copies[0][1].data as { name: string }).name).toBe("remote (Remote)");
    expect(both.items.has("savedQueries:d")).toBe(true);
  });

  test("first sync with identical content is conflict free", () => {
    const local = snap([["savedQueries:a", entry("A", 1)]]);
    const remote = snap([["savedQueries:a", entry("A", 2)]]);
    expect(mergeSnapshots(local, remote, new Map()).conflicts).toEqual([]);
  });
});

describe("engine", () => {
  test("sync uses one GET and one PUT, skips unchanged uploads and propagates changes", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    const b = device("b", remote, coordinator);
    a.collections.connections = [connection("c1", "Prod")];
    a.collections.snippets = [
      { id: "s1", data: { id: "s1", name: "sel", body: "SELECT", shortcut: "sel" }, updatedAt: 3 },
    ];
    const first = await sync(a);
    expect(first.uploaded).toBe(true);
    expect([remote.gets, remote.puts]).toEqual([1, 1]);
    const again = await sync(a);
    expect(again.status).toBe("skipped");
    expect([remote.gets, remote.puts]).toEqual([2, 1]);
    const pulled = await sync(b);
    expect(pulled.applied?.connections.added).toBe(1);
    expect(pulled.uploaded).toBe(false);
    expect(b.backups).toHaveLength(1);
    expect(b.collections.connections[0].id).toBe("c1");
    b.collections.connections = [];
    await sync(b);
    const removed = await sync(a);
    expect(removed.applied?.connections.removed).toBe(1);
    expect(a.collections.connections).toEqual([]);
    expect(coordinator.active).toBeNull();
  });

  test("real conflicts ask the decider and can be cancelled without changes", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    const b = device("b", remote, coordinator);
    a.collections.connections = [connection("c1", "Prod")];
    await sync(a);
    await sync(b);
    a.collections.connections = [connection("c1", "Prod A")];
    b.collections.connections = [connection("c1", "Prod B")];
    await sync(a);
    const asked: number[] = [];
    const outcome = await sync(
      b,
      "sync",
      {},
      {
        conflicts: async (list) => {
          asked.push(list.length);
          return null;
        },
        preview: async () => true,
      },
    );
    expect(asked).toEqual([1]);
    expect(outcome.status).toBe("conflict");
    expect((b.collections.connections[0].data as { name: string }).name).toBe("Prod B");
    const merged = await sync(b);
    expect(merged.conflicts).toBe(1);
    expect(
      b.collections.connections.map((item) => (item.data as { name: string }).name).sort(),
    ).toEqual(["Prod A (Remote)", "Prod B"]);
  });

  test("preview rejection leaves local data and remote untouched", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    const b = device("b", remote, coordinator);
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q", sql: "SELECT 1" } }];
    await sync(a);
    const outcome = await sync(
      b,
      "download",
      {},
      { conflicts: async () => null, preview: async () => false },
    );
    expect(outcome.status).toBe("cancelled");
    expect(b.collections.savedQueries).toEqual([]);
    expect(b.backups).toEqual([]);
    expect(remote.puts).toBe(1);
  });

  test("upload overwrites, download replaces, and concurrent remote edits are detected", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q", sql: "SELECT 1" } }];
    await sync(a, "upload");
    expect([remote.gets, remote.puts]).toEqual([0, 1]);
    const b = device("b", remote, coordinator);
    b.collections.savedQueries = [{ id: "z", data: { id: "z", name: "Z", sql: "SELECT 2" } }];
    const replaced = await sync(b, "download");
    expect(replaced.applied?.savedQueries).toEqual({ added: 1, updated: 0, removed: 1 });
    expect(b.collections.savedQueries.map((item) => item.id)).toEqual(["q"]);
    const racing = device("c", remote, coordinator);
    racing.collections.savedQueries = [{ id: "r", data: { id: "r", name: "R", sql: "SELECT 3" } }];
    const originalFetch = racing.deps.transport.fetch;
    racing.deps.transport.fetch = async (target, opId) => {
      const file = await originalFetch(target, opId);
      remote.version++;
      return file;
    };
    await expect(sync(racing)).rejects.toBeInstanceOf(SyncRemoteChangedError);
    expect(coordinator.active).toBeNull();
  });

  test("history stays on the server when this device does not sync it", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    a.collections.history = [
      { id: "h1", data: { id: "h1", connectionId: "c", sql: "SELECT", ranAt: 5 }, updatedAt: 5 },
    ];
    await sync(a, "sync", { includeHistory: true });
    const b = device("b", remote, coordinator);
    b.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q", sql: "SELECT 1" } }];
    await sync(b);
    expect(b.collections.history).toEqual([]);
    const document = parseDocument(remote.content as string);
    expect(Object.keys(document.items.history ?? {})).toEqual(["h1"]);
    expect(Object.keys(document.items.savedQueries ?? {})).toEqual(["q"]);
  });

  test("secrets and full payload are encrypted, wrong passphrase fails loudly", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    a.collections.connections = [connection("c1", "Prod")];
    a.secrets.set("c1", "s3cr3t-pw");
    const options = { includeSecrets: true, encryptAll: true };
    await sync(a, "sync", options);
    expect(remote.content).not.toContain("s3cr3t-pw");
    expect(remote.content).not.toContain("Prod");
    expect(JSON.parse(remote.content as string)).toHaveProperty("encrypted");
    const again = await sync(a, "sync", options);
    expect(again.status).toBe("skipped");
    const b = device("b", remote, coordinator);
    await sync(b, "sync", options);
    expect(b.secrets.get("c1")).toBe("s3cr3t-pw");
    const wrong = device("w", remote, coordinator, { passphrase: { value: "falsch" } });
    await expect(sync(wrong, "sync", options)).rejects.toThrow("Passphrase falsch");
    expect(wrong.collections.connections).toEqual([]);
    expect(coordinator.active).toBeNull();
  });

  test("only one sync runs at a time across windows and aborted syncs release the lease", async () => {
    const remote = new FakeRemote();
    remote.delayMs = 50;
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    const b = device("b", remote, coordinator);
    const controller = new AbortController();
    const running = sync(a, "sync", {}, acceptAll, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(sync(b)).rejects.toBeInstanceOf(SyncBusyError);
    controller.abort();
    await expect(running).rejects.toThrow("abgebrochen");
    expect(remote.cancelled).toHaveLength(1);
    expect(remote.puts).toBe(0);
    expect(coordinator.active).toBeNull();
    expect(a.base.size).toBe(0);
    remote.delayMs = 0;
    await sync(b);
    expect(remote.maxInFlight).toBe(1);
  });
});

describe("auto sync", () => {
  test("is idle unless enabled and configured, with a 15 minute floor", () => {
    expect(autoSyncPlan({ autoSync: false, configured: true, intervalMinutes: 30 })).toBeNull();
    expect(autoSyncPlan({ autoSync: true, configured: false, intervalMinutes: 30 })).toBeNull();
    expect(autoSyncPlan({ autoSync: true, configured: true, intervalMinutes: 1 })).toEqual({
      intervalMs: 15 * 60_000,
    });
  });

  test("backs off exponentially, stops cleanly and only the leader syncs", async () => {
    const timers: { callback: () => void; ms: number }[] = [];
    const schedule = (callback: () => void, ms: number) => timers.push({ callback, ms });
    const cleared: unknown[] = [];
    let runs = 0;
    let fail = true;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1));
    const stop = startAutoSync({
      intervalMs: 1000,
      syncOnStart: true,
      claim: async () => true,
      release: async () => undefined,
      run: async () => {
        runs++;
        if (fail) throw new Error("offline");
      },
      schedule,
      clear: (handle) => cleared.push(handle),
    });
    await settle();
    expect(runs).toBe(1);
    expect(timers.at(-1)?.ms).toBe(2000);
    timers.shift()?.callback();
    await settle();
    expect(timers.at(-1)?.ms).toBe(4000);
    fail = false;
    timers.shift()?.callback();
    await settle();
    expect(timers.at(-1)?.ms).toBe(1000);
    stop();
    expect(cleared).toHaveLength(1);
    timers.shift()?.callback();
    await settle();
    expect(runs).toBe(3);
    expect(backoffDelay(15 * 60_000, 10)).toBe(6 * 60 * 60 * 1000);

    let follower = 0;
    const stopFollower = startAutoSync({
      intervalMs: 1000,
      syncOnStart: true,
      claim: async () => false,
      release: async () => undefined,
      run: async () => {
        follower++;
      },
      schedule,
      clear: () => undefined,
    });
    await settle();
    expect(follower).toBe(0);
    stopFollower();
  });
});
