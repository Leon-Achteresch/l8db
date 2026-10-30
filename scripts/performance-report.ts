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

type Resources = ReturnType<typeof normalizeProcessResources>;

const cpuTotal = (resources: Resources | null) =>
  resources ? resources.userCpuMs + resources.systemCpuMs : 0;

export function resourceViolations(
  resources: Resources,
  limits: { peakRssBytes: number; cpuMs: number },
  startup: Resources | null = null,
) {
  const violations: string[] = [];
  const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (!Number.isFinite(resources.peakRssBytes) || resources.peakRssBytes <= 0)
    violations.push("Peak RSS was not measured");
  else if (resources.peakRssBytes > limits.peakRssBytes)
    violations.push(
      `Peak RSS budget exceeded: ${mib(resources.peakRssBytes)} > ${mib(limits.peakRssBytes)}`,
    );
  const cpuMs = cpuTotal(resources);
  const budgetedCpuMs = cpuTotal(workloadResources(resources, startup));
  if (!Number.isFinite(cpuMs) || cpuMs <= 0) violations.push("CPU time was not measured");
  else if (budgetedCpuMs > limits.cpuMs)
    violations.push(
      `CPU budget exceeded: ${(budgetedCpuMs / 1000).toFixed(2)} s > ${(limits.cpuMs / 1000).toFixed(2)} s`,
    );
  return violations;
}

export interface FileRun {
  file: string;
  exitCode: number | null;
  executedTests: number | null;
  resources: ReturnType<typeof normalizeProcessResources> | null;
  outcomes?: Map<string, "pass" | "fail">;
}

export function combineFileRuns(runs: FileRun[]) {
  const measured = runs.map((run) => run.resources);
  const resources = measured.every((value) => value !== null)
    ? {
        peakRssBytes: Math.max(0, ...measured.map((value) => value?.peakRssBytes ?? 0)),
        userCpuMs: measured.reduce((sum, value) => sum + (value?.userCpuMs ?? 0), 0),
        systemCpuMs: measured.reduce((sum, value) => sum + (value?.systemCpuMs ?? 0), 0),
      }
    : null;
  const counts = runs.map((run) => run.executedTests);
  return {
    exitCode: runs.find((run) => run.exitCode !== 0)?.exitCode ?? 0,
    executedTests: counts.some((count) => count === null)
      ? null
      : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0),
    resources,
    failedFiles: runs.filter((run) => run.exitCode !== 0).map((run) => run.file),
  };
}

export function medianResources(samples: (ReturnType<typeof normalizeProcessResources> | null)[]) {
  const measured = samples
    .filter((sample) => sample !== null)
    .sort((a, b) => a.userCpuMs + a.systemCpuMs - (b.userCpuMs + b.systemCpuMs));
  return measured[Math.floor(measured.length / 2)] ?? null;
}

export function workloadResources(resources: Resources, startup: Resources | null) {
  return {
    peakRssBytes: resources.peakRssBytes,
    userCpuMs: Math.max(0, resources.userCpuMs - (startup?.userCpuMs ?? 0)),
    systemCpuMs: Math.max(0, resources.systemCpuMs - (startup?.systemCpuMs ?? 0)),
  };
}

export function fileBudgets(
  runs: FileRun[],
  limits: { peakRssBytes: number; cpuMs: number },
  startup: Resources | null,
) {
  const files = runs.map(({ outcomes: _outcomes, ...run }) => ({
    ...run,
    budgetedResources: run.resources && workloadResources(run.resources, startup),
  }));
  const largest = files.reduce((max, run) =>
    cpuTotal(run.budgetedResources) > cpuTotal(max.budgetedResources) ? run : max,
  );
  return {
    files,
    budgetedResources: combineFileRuns(
      files.map((run) => ({ ...run, resources: run.budgetedResources })),
    ).resources,
    mostExpensiveFile: { file: largest.file, budgetedCpuMs: cpuTotal(largest.budgetedResources) },
    violations: files.flatMap(({ file, resources }) =>
      (resources
        ? resourceViolations(resources, limits, startup)
        : ["Resource usage unavailable"]
      ).map((violation) => `${file}: ${violation}`),
    ),
  };
}

export function testOutcomes(output: string): Map<string, "pass" | "fail"> {
  const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const outcomes = new Map<string, "pass" | "fail">();
  for (const line of output.replace(colors, "").split(/\r?\n/)) {
    const match = line.match(/^\((pass|fail)\) (.+?)(?: \[[0-9.]+ms\])?\s*$/);
    if (match) outcomes.set(match[2], match[1] as "pass" | "fail");
  }
  return outcomes;
}

export function testNamePattern(names: readonly string[]) {
  const literal = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  return `^(${names.map((name) => literal(name.split(" > ").join(" "))).join("|")})$`;
}

export function confirmedFailures(
  failed: readonly string[],
  reruns: readonly { outcomes: Map<string, "pass" | "fail">; executedTests: number | null }[],
) {
  return failed.filter(
    (name) =>
      !reruns.every(
        (rerun) => rerun.executedTests === failed.length && rerun.outcomes.get(name) !== "fail",
      ),
  );
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
