import { describe, expect, test } from "bun:test";
import { autoSyncPlan, backoffDelay, startAutoSync } from "../src/lib/sync/auto-sync";
import { restoreScope } from "../src/lib/sync/controller";
import {
  MAX_SYNC_ATTEMPTS,
  runSync,
  SyncBusyError,
  SyncRemoteChangedError,
} from "../src/lib/sync/engine";
import { createInteractiveDecider } from "../src/lib/sync/interactive-decider";
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
  readSyncBase,
  targetChangeNeedsConfirmation,
  targetKey,
  useSyncStore,
  writeSyncBase,
} from "../src/lib/sync/store";
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
    memory: { deviceId: dev.label, lastSalt: null, lastMode: dev.lastMode },
    decider,
    signal,
  }).then((outcome) => {
    if (outcome.status === "ok" || outcome.status === "skipped") dev.lastMode = outcome.mode;
    return outcome;
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

describe("review regressions", () => {
  test("a newer local password is never replaced by a stale remote one, cleared ones propagate", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    let clock = 1000;
    const a = device("a", remote, coordinator, { clock: () => clock });
    const b = device("b", remote, coordinator, { clock: () => clock });
    const options = { includeSecrets: true };
    a.collections.connections = [connection("c1", "Prod")];
    a.secrets.set("c1", "alt");
    await sync(a, "sync", options);
    clock = 2000;
    await sync(b, "sync", options);
    expect(b.secrets.get("c1")).toBe("alt");
    clock = 3000;
    a.secrets.set("c1", "neu");
    await sync(a, "sync", options);
    expect(a.secrets.get("c1")).toBe("neu");
    clock = 4000;
    await sync(b, "sync", options);
    expect(b.secrets.get("c1")).toBe("neu");
    clock = 5000;
    b.secrets.delete("c1");
    await sync(b, "sync", options);
    clock = 6000;
    await sync(a, "sync", options);
    expect(a.secrets.has("c1")).toBe(false);
  });

  test("switching on full encryption re-uploads instead of leaving plain text", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    a.collections.connections = [connection("c1", "Prod")];
    await sync(a);
    expect(remote.content).toContain("Prod");
    const encrypted = await sync(a, "sync", { includeSecrets: true, encryptAll: true });
    expect(encrypted.uploaded).toBe(true);
    expect(remote.content).not.toContain("Prod");
    const plain = await sync(a);
    expect(plain.uploaded).toBe(true);
    expect(remote.content).toContain("Prod");
  });

  test("remote changes during upload are re-fetched and re-merged with a bounded retry", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q", sql: "SELECT 1" } }];
    await sync(a);
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q2", sql: "SELECT 1" } }];
    const store = a.deps.transport.store;
    let races = 1;
    a.deps.transport.store = async (...args) => {
      if (races-- > 0) remote.version++;
      return store(...args);
    };
    remote.gets = 0;
    const retried = await sync(a);
    expect(retried.attempts).toBe(2);
    expect(remote.gets).toBe(2);
    races = 10;
    remote.gets = 0;
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q3", sql: "SELECT 1" } }];
    await expect(sync(a)).rejects.toBeInstanceOf(SyncRemoteChangedError);
    expect(remote.gets).toBe(MAX_SYNC_ATTEMPTS);
    expect(coordinator.active).toBeNull();
  });

  test("abandoned decisions release the pending sync and the cross-window lease", async () => {
    for (const kind of ["conflicts", "preview"] as const) {
      const remote = new FakeRemote();
      const coordinator = new FakeCoordinator();
      const a = device("a", remote, coordinator);
      const b = device("b", remote, coordinator);
      a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A", sql: "1" } }];
      await sync(a);
      if (kind === "conflicts") {
        await sync(b);
        a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A2", sql: "1" } }];
        b.collections.savedQueries = [{ id: "q", data: { id: "q", name: "B2", sql: "1" } }];
        await sync(a);
      }
      const controller = new AbortController();
      let asked = false;
      const never = new Promise<never>(() => undefined);
      const pending = sync(
        b,
        "sync",
        {},
        {
          conflicts: () => {
            asked = true;
            return never;
          },
          preview: () => {
            asked = true;
            return never;
          },
        },
        controller.signal,
      );
      while (!asked) await new Promise((resolve) => setTimeout(resolve, 1));
      expect(coordinator.active).toBe("b");
      controller.abort();
      await expect(pending).rejects.toThrow("abgebrochen");
      expect(coordinator.active).toBeNull();
    }
  });

  test("disposing the interactive decider settles open and future dialogs", async () => {
    const shown: unknown[] = [];
    const interactive = createInteractiveDecider({
      conflicts: (list) => shown.push(list),
      preview: (decision) => shown.push(decision),
    });
    const conflict = interactive.decider.conflicts([]);
    interactive.dispose();
    expect(await conflict).toBeNull();
    expect(await interactive.decider.preview({} as never)).toBe(false);
    const dismissed = createInteractiveDecider({ conflicts: () => {}, preview: () => {} });
    const preview = dismissed.decider.preview({} as never);
    dismissed.resolvePreview(false);
    expect(await preview).toBe(false);
  });

  test("unknown collections from newer builds survive a round trip", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "Q", sql: "SELECT 1" } }];
    await sync(a);
    const document = JSON.parse(remote.content as string);
    document.items.dashboards = { d1: { updatedAt: 1, data: { id: "d1" } } };
    remote.content = JSON.stringify(document);
    a.collections.savedQueries = [];
    await sync(a);
    const next = JSON.parse(remote.content as string);
    expect(next.items.dashboards).toEqual({ d1: { updatedAt: 1, data: { id: "d1" } } });
    expect(() => parseEnvelope('{"format":"l8db-sync","schemaVersion":2}')).toThrow(
      "Bitte l8db aktualisieren",
    );
  });

  test("backup restore respects the current history setting", () => {
    const snapshot = buildSnapshot(
      {
        ...emptyCollections(),
        history: [{ id: "h", data: { id: "h", connectionId: "c", sql: "x", ranAt: 1 } }],
      },
      new Map(),
      1,
    );
    const document = toDocument(snapshot, {
      deviceId: "a",
      updatedAt: 1,
      contentHash: "",
      secrets: null,
      include: ["history", "savedQueries"],
    });
    expect([...restoreScope(document, false)]).toEqual(["savedQueries"]);
    expect([...restoreScope(document, true)].sort()).toEqual(["history", "savedQueries"]);
  });

  test("editing target fields only resets sync state on a real committed change", () => {
    const config = {
      provider: "webdav" as const,
      webdavUrl: "https://cloud.example/dav/",
      webdavPath: "/l8db/l8db-sync.json",
      gistId: "",
    };
    expect(targetKey({ ...config, webdavUrl: " https://cloud.example/dav " })).toBe(
      targetKey(config),
    );
    expect(targetKey({ ...config, webdavPath: "l8db//l8db-sync.json" })).toBe(targetKey(config));
    expect(
      targetChangeNeedsConfirmation({ ...config, lastSyncAt: 1 }, { webdavPath: "/x.json" }),
    ).toBe(true);
    expect(
      targetChangeNeedsConfirmation({ ...config, lastSyncAt: null }, { webdavPath: "/x.json" }),
    ).toBe(false);
    writeSyncBase(new Map([["savedQueries:q", ["h", 1]]]));
    useSyncStore.setState({ ...config, lastSyncAt: 1 });
    useSyncStore.getState().configure({ webdavUser: "neu" });
    useSyncStore.getState().commitTarget({ webdavUrl: "https://cloud.example/dav" });
    expect(readSyncBase().size).toBe(1);
    useSyncStore.getState().commitTarget({ webdavPath: "/anders.json" });
    expect(readSyncBase().size).toBe(0);
  });
});

describe("second review regressions", () => {
  test("a retry does not treat items pulled in the first attempt as local edits", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    const b = device("b", remote, new FakeCoordinator());
    const c = device("c", remote, new FakeCoordinator());
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A", sql: "1" } }];
    await sync(a);
    await sync(b);
    await sync(c);
    b.collections.savedQueries = [{ id: "q", data: { id: "q", name: "B", sql: "1" } }];
    await sync(b);
    a.collections.snippets = [
      { id: "s", data: { id: "s", name: "s", body: "x", shortcut: "s" }, updatedAt: 1 },
    ];
    const store = a.deps.transport.store;
    let raced = false;
    a.deps.transport.store = async (...args) => {
      if (!raced) {
        raced = true;
        await sync(c);
        c.collections.savedQueries = [{ id: "q", data: { id: "q", name: "C", sql: "1" } }];
        await sync(c);
      }
      return store(...args);
    };
    let asked = 0;
    const outcome = await sync(
      a,
      "sync",
      {},
      {
        conflicts: async () => {
          asked++;
          return "local";
        },
        preview: async () => true,
      },
    );
    expect(outcome.attempts).toBe(2);
    expect(asked).toBe(0);
    expect(nameOf({ items: new Map(a.collections.savedQueries.map((i) => [i.id, i])) }, "q")).toBe(
      "C",
    );
  });

  test("an abort while the lease is being granted still releases it", async () => {
    const remote = new FakeRemote();
    const coordinator = new FakeCoordinator();
    const a = device("a", remote, coordinator);
    const begin = a.deps.transport.begin;
    const controller = new AbortController();
    a.deps.transport.begin = async () => {
      const granted = await begin();
      controller.abort();
      return granted;
    };
    await expect(sync(a, "sync", {}, acceptAll, controller.signal)).rejects.toThrow("abgebrochen");
    expect(coordinator.active).toBeNull();
  });

  test("an abort after local apply leaves a base that avoids false conflicts", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    const b = device("b", remote, new FakeCoordinator());
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A", sql: "1" } }];
    await sync(a);
    await sync(b);
    b.collections.savedQueries = [{ id: "q", data: { id: "q", name: "B", sql: "1" } }];
    await sync(b);
    a.collections.snippets = [
      { id: "s", data: { id: "s", name: "s", body: "x", shortcut: "s" }, updatedAt: 1 },
    ];
    const controller = new AbortController();
    const store = a.deps.transport.store;
    a.deps.transport.store = async (...args) => {
      controller.abort();
      return store(...args);
    };
    await expect(sync(a, "sync", {}, acceptAll, controller.signal)).rejects.toThrow();
    a.deps.transport.store = store;
    let asked = 0;
    await sync(
      a,
      "sync",
      {},
      {
        conflicts: async () => {
          asked++;
          return null;
        },
        preview: async () => true,
      },
    );
    expect(asked).toBe(0);
  });

  test("devices with different encryption settings do not keep re-uploading", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    const b = device("b", remote, new FakeCoordinator());
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A", sql: "1" } }];
    const encrypted = { includeSecrets: true, encryptAll: true };
    await sync(a, "sync", encrypted);
    await sync(b);
    const puts = remote.puts;
    for (let round = 0; round < 3; round++) {
      await sync(a, "sync", encrypted);
      await sync(b);
    }
    expect(remote.puts).toBe(puts);
  });

  test("remote items taken with a wrong per-item hash are re-hashed", async () => {
    const remote = new FakeRemote();
    const a = device("a", remote, new FakeCoordinator());
    const b = device("b", remote, new FakeCoordinator());
    a.collections.savedQueries = [{ id: "q", data: { id: "q", name: "A", sql: "1" } }];
    await sync(a);
    await sync(b);
    const document = JSON.parse(remote.content as string);
    document.items.savedQueries.q = {
      updatedAt: 9,
      h: "zz.zz",
      data: { id: "q", name: "X", sql: "1" },
    };
    remote.content = JSON.stringify(document);
    await sync(b);
    expect(b.base.get("savedQueries:q")?.[0]).toBe(hashData({ id: "q", name: "X", sql: "1" }));
  });
});
