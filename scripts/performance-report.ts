import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface ProcessResources {
  maxRSS: number;
  cpuTime: { user: number | bigint; system: number | bigint };
}

export function normalizeProcessResources(usage: ProcessResources, platform: string) {
  return {
    peakRssBytes: usage.maxRSS * (platform === "darwin" ? 1 : 1024),
    userCpuMs: Number(usage.cpuTime.user) / 1000,
    systemCpuMs: Number(usage.cpuTime.system) / 1000,
  };
}

export function resourceViolations(
  resources: ReturnType<typeof normalizeProcessResources>,
  limits: { peakRssBytes: number; cpuMs: number },
) {
  const violations: string[] = [];
  if (!Number.isFinite(resources.peakRssBytes) || resources.peakRssBytes <= 0)
    violations.push("Peak RSS was not measured");
  else if (resources.peakRssBytes > limits.peakRssBytes)
    violations.push("Peak RSS budget exceeded");
  const cpuMs = resources.userCpuMs + resources.systemCpuMs;
  if (!Number.isFinite(cpuMs) || cpuMs <= 0) violations.push("CPU time was not measured");
  else if (cpuMs > limits.cpuMs) violations.push("CPU budget exceeded");
  return violations;
}

export function executedTestCount(output: string): number | null {
  const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const plain = output.replace(colors, "");
  let passed: number | undefined;
  let failed: number | undefined;
  for (const match of plain.matchAll(/^\s*(\d+) (pass|fail)\s*$/gm)) {
    if (match[2] === "pass") passed = Number(match[1]);
    else failed = Number(match[1]);
  }
  return passed === undefined || failed === undefined ? null : passed + failed;
}

export async function reportScenario(name: string, values: Record<string, unknown>) {
  const report = {
    ...values,
    name,
    runId: process.env.L8DB_PERF_RUN_ID ?? null,
    capturedAt: new Date().toISOString(),
  };
  console.log(`performance ${name}: ${JSON.stringify(report)}`);
  const directory = process.env.L8DB_PERF_REPORT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await Bun.write(resolve(directory, `${name}.json`), JSON.stringify(report, null, 2));
}

export async function measureScenario(run: () => void | Promise<void>, runs = 9) {
  await run();
  await run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }
  durations.sort((left, right) => left - right);
  return {
    runs,
    medianMs: durations[Math.floor(durations.length / 2)],
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    maxMs: durations.at(-1),
  };
}
