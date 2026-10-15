import { expect, mock, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { reportScenario } from "./fixtures/usage-performance";

const IPC_DELAY_MS = 1;
let invokes = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => {
    invokes++;
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
