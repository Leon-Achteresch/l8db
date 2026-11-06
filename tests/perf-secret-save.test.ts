import { heapSize } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { reportScenario } from "./fixtures/usage-performance";

const IPC_DELAY_MS = 1;
let invokes = 0;
let reads = 0;
let activeReads = 0;
let peakReads = 0;
let databaseRequests = 0;
let loadGate: Promise<void> | null = null;
const keychain = new Map<string, string>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, string> = {}) => {
    if (command === "store_secret" || command === "load_secret") invokes++;
    if (command === "load_secret") {
      reads++;
      activeReads++;
      peakReads = Math.max(peakReads, activeReads);
      try {
        await (loadGate ?? new Promise((resolve) => setTimeout(resolve, IPC_DELAY_MS)));
        return keychain.get(args.account) ?? null;
      } finally {
        activeReads--;
      }
    }
    if (command === "execute_query" || command === "test_connection_string") databaseRequests++;
    await new Promise((resolve) => setTimeout(resolve, IPC_DELAY_MS));
    return null;
  },
  transformCallback: () => 1,
}));

const { storeSecret } = await import("../src/lib/secrets");

async function measure(prefix: string, runs: number) {
  const durations: number[] = [];
  invokes = 0;
  for (let index = 0; index < runs; index++) {
    const started = performance.now();
    await storeSecret(`${prefix}${index}`, `pw-${index}`);
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  return {
    runs,
    invokesPerSave: invokes / runs,
    medianMs: durations[Math.floor(runs / 2)],
    p95Ms: durations[Math.ceil(runs * 0.95) - 1],
  };
}

async function timerTickMs() {
  const durations: number[] = [];
  for (let index = 0; index < 20; index++) {
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, IPC_DELAY_MS));
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.ceil(durations.length * 0.95) - 1];
}

test("tracking password edits costs at most one extra keychain read per tracked save", async () => {
  const tickMs = await timerTickMs();
  const untracked = await measure("automation:smtp:", 60);
  const tracked = await measure("conn-", 60);
  reportScenario("secret-save", {
    environment: {
      os: `${platform()} ${release()}`,
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      ramGb: Math.round(totalmem() / 1024 ** 3),
      runtime: `bun ${Bun.version}`,
    },
    simulatedIpcDelayMs: IPC_DELAY_MS,
    timerTickMs: tickMs,
    untracked,
    tracked,
  });
  expect(untracked.invokesPerSave).toBe(1);
  expect(tracked.invokesPerSave).toBe(2);
  expect(tracked.p95Ms).toBeLessThan(untracked.p95Ms * 2 + Math.max(10, tickMs));
});

test("password restoration stays bounded in a catalog of 1,000 connections", async () => {
  const { useConnectionsStore } = await import("../src/lib/connections");
  const { ensurePassword, needsPassword, usePasswordPrompt } = await import(
    "../src/lib/password-prompt"
  );
  const connections = Array.from({ length: 1_000 }, (_, index) => ({
    id: `restore-perf-${index}`,
    name: `Connection ${index}`,
    kind: "postgres" as const,
    connectionString: `postgresql://user@db-${index}.example.test/app`,
    sslMode: "prefer" as const,
  }));
  const selected = connections.slice(-60);
  for (const connection of selected) keychain.set(connection.id, `password-${connection.id}`);
  useConnectionsStore.setState({ connections });
  const baselinePrompts = selected.filter(needsPassword).length;
  const budgets = { coldP95Ms: 50, warmP95Ms: 5, retainedBytes: 8 * 1024 * 1024, cancelMs: 250 };
  reads = 0;
  peakReads = 0;
  databaseRequests = 0;
  Bun.gc(true);
  const heapBefore = heapSize();
  const measureRestoration = async () => {
    const durations: number[] = [];
    for (const connection of selected) {
      const started = performance.now();
      expect(await ensurePassword(connection.id)).toBe(true);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    return {
      medianMs: durations[Math.floor(durations.length / 2)],
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    };
  };
  const cold = await measureRestoration();
  const coldReads = reads;
  const warm = await measureRestoration();
  expect(coldReads).toBe(selected.length);
  expect(reads).toBe(coldReads);
  expect(peakReads).toBe(1);
  expect(databaseRequests).toBe(0);
  expect(usePasswordPrompt.getState().connection).toBeNull();
  expect(cold.p95Ms).toBeLessThan(budgets.coldP95Ms);
  expect(warm.p95Ms).toBeLessThan(budgets.warmP95Ms);
  Bun.gc(true);
  const retainedBytes = heapSize() - heapBefore;
  expect(retainedBytes).toBeLessThan(budgets.retainedBytes);

  let resume: () => void = () => undefined;
  loadGate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const controller = new AbortController();
  let settled = false;
  let cancelSettleMs = Infinity;
  const cancelStarted = performance.now();
  const pending = ensurePassword(connections[0].id, undefined, controller.signal).then((result) => {
    settled = true;
    cancelSettleMs = performance.now() - cancelStarted;
    return result;
  });
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const settledBeforeResume = settled;
  resume();
  expect(await pending).toBe(false);
  expect(settledBeforeResume).toBe(true);
  expect(cancelSettleMs).toBeLessThan(budgets.cancelMs);
  loadGate = null;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(activeReads).toBe(0);
  expect(usePasswordPrompt.getState().connection).toBeNull();
  const idleReads = reads;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(reads).toBe(idleReads);

  reportScenario("secret-restore", {
    environment: {
      os: `${platform()} ${release()}`,
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      ramGb: Math.round(totalmem() / 1024 ** 3),
      runtime: `bun ${Bun.version}`,
    },
    catalog: connections.length,
    restored: selected.length,
    baselinePrompts,
    resultingPrompts: 0,
    simulatedIpcDelayMs: IPC_DELAY_MS,
    cold,
    warm,
    coldReads,
    warmReads: 0,
    peakReads,
    databaseRequests,
    retainedBytes,
    cancelSettleMs,
    idleReads: 0,
    budgets,
  });
});
