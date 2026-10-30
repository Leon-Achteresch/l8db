import { mkdir } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";

export const CPU_REFERENCE_MS = 59.4;

export interface CpuCalibration {
  benchmarkMs: number;
  referenceMs: number;
  samplesMs: number[];
  cpu: string | null;
}

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

export function workloadResources(
  total: ReturnType<typeof normalizeProcessResources>,
  startup: ReturnType<typeof normalizeProcessResources> | null,
  processes: number,
) {
  const extra = Math.max(0, processes - 1);
  return {
    peakRssBytes: total.peakRssBytes,
    userCpuMs: Math.max(0, total.userCpuMs - (startup?.userCpuMs ?? 0) * extra),
    systemCpuMs: Math.max(0, total.systemCpuMs - (startup?.systemCpuMs ?? 0) * extra),
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
  const calibration = cpuCalibration();
  const report = {
    ...values,
    ...(calibration && typeof values.cpuRate === "number"
      ? {
          appliedCpuRate: calibratedCpuRate(values.cpuRate, calibration),
          cpuCalibration: calibration,
        }
      : {}),
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

export function calibratedCpuRate(nominal: number, calibration: CpuCalibration | null) {
  if (!calibration) return nominal;
  return Math.max(
    1,
    Math.round((nominal * calibration.referenceMs * 100) / calibration.benchmarkMs) / 100,
  );
}

export function cpuCalibration(): CpuCalibration | null {
  const value = process.env.L8DB_PERF_CPU_CALIBRATION;
  return value ? JSON.parse(value) : null;
}

function cpuBenchmark({ warmups, runs }: { warmups: number; runs: number }) {
  type Item = { tag: string; text: string; children: Item[] };
  const work = () => {
    let seed = 1;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const rows = Array.from({ length: 20000 }, (_, id) => ({
      id,
      name: `table_${Math.floor(next() * 1e6).toString(36)}`,
      size: Math.floor(next() * 1e6),
      flags: [id % 3, id % 7],
    }));
    rows.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : left.size - right.size,
    );
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = row.name.slice(0, 8);
      totals.set(key, (totals.get(key) ?? 0) + row.size + row.flags[0]);
    }
    const tree = (depth: number): Item =>
      depth === 0
        ? { tag: "span", text: String(next()), children: [] }
        : { tag: "div", text: "", children: [tree(depth - 1), tree(depth - 1), tree(depth - 1)] };
    const count = (node: Item): number =>
      node.children.reduce((sum, child) => sum + count(child), node.text.length);
    const copies = JSON.parse(JSON.stringify(rows.slice(0, 2000))).length;
    const words = rows
      .map((row) => row.name)
      .join(" ")
      .match(/_[0-9a-f]+/g)?.length;
    return totals.size + count(tree(8)) + copies + (words ?? 0);
  };
  const samples: number[] = [];
  let checksum = 0;
  for (let run = 0; run < warmups + runs; run++) {
    const started = performance.now();
    for (let pass = 0; pass < 6; pass++) checksum += work();
    if (run >= warmups) samples.push(performance.now() - started);
  }
  return { samples, checksum };
}

export async function measureCpuCalibration(): Promise<CpuCalibration> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const { samples } = await (await browser.newPage()).evaluate(cpuBenchmark, {
      warmups: 3,
      runs: 9,
    });
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      benchmarkMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
      referenceMs: CPU_REFERENCE_MS,
      samplesMs: samples.map((sample) => Math.round(sample * 10) / 10),
      cpu: cpus()[0]?.model ?? null,
    };
  } finally {
    await browser.close();
  }
}

export async function cpuThrottleRate(nominal: number) {
  process.env.L8DB_PERF_CPU_CALIBRATION ||= JSON.stringify(await measureCpuCalibration());
  const calibration = cpuCalibration();
  const applied = calibratedCpuRate(nominal, calibration);
  console.log(`performance cpu-throttle: ${JSON.stringify({ nominal, applied, ...calibration })}`);
  return applied;
}
