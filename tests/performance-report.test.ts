import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  combineFileRuns,
  confirmedFailures,
  executedTestCount,
  normalizeProcessResources,
  resourceViolations,
  testNamePattern,
  testOutcomes,
} from "../scripts/performance-report";
import { parsePerformanceArgs } from "../scripts/test-performance";

test("Bun 1.3.10 process memory is normalized across Linux, Windows and macOS", () => {
  const linux = normalizeProcessResources(
    { maxRSS: 4096, cpuTime: { user: 2000n, system: 3000n } },
    "linux",
  );
  expect(linux).toEqual({ peakRssBytes: 4 * 1024 * 1024, userCpuMs: 2, systemCpuMs: 3 });
  expect(
    normalizeProcessResources({ maxRSS: 4096, cpuTime: { user: 2000, system: 3000 } }, "win32"),
  ).toEqual(linux);
  expect(
    normalizeProcessResources(
      { maxRSS: 4 * 1024 * 1024, cpuTime: { user: 2000, system: 3000 } },
      "darwin",
    ),
  ).toEqual(linux);
});

test("missing measurements and exceeded resource budgets fail the performance gate", () => {
  const limits = { peakRssBytes: 4096, cpuMs: 10 };
  expect(resourceViolations({ peakRssBytes: 4096, userCpuMs: 7, systemCpuMs: 3 }, limits)).toEqual(
    [],
  );
  expect(resourceViolations({ peakRssBytes: 4097, userCpuMs: 8, systemCpuMs: 3 }, limits)).toEqual([
    "Peak RSS budget exceeded",
    "CPU budget exceeded",
  ]);
  expect(
    resourceViolations({ peakRssBytes: 0, userCpuMs: Number.NaN, systemCpuMs: 0 }, limits),
  ).toEqual(["Peak RSS was not measured", "CPU time was not measured"]);
});

test("empty selections and skipped tests cannot establish a successful performance run", () => {
  expect(executedTestCount(" 0 pass\n 12 filtered out\n 0 fail\nRan 0 tests")).toBe(0);
  expect(executedTestCount(" 0 pass\n 8 skip\n 0 fail\nRan 8 tests")).toBe(0);
  expect(executedTestCount(" 2 pass\n 1 fail\nRan 3 tests")).toBe(3);
  expect(executedTestCount("\u001b[32m 4 pass\u001b[0m\n 0 fail\n")).toBe(4);
  expect(executedTestCount("Build failed before tests started")).toBeNull();
});

test("scenario artifacts identify their current run instead of reusing stale measurement metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "l8db-performance-provenance-"));
  const started = Date.now();
  try {
    const source = resolve(import.meta.dir, "../scripts/performance-report.ts");
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `import { reportScenario } from ${JSON.stringify(source)}; await reportScenario("provenance", { rows: 5000, name: "stale", runId: "stale", capturedAt: "stale" });`,
      ],
      {
        env: {
          ...process.env,
          L8DB_PERF_REPORT_DIR: directory,
          L8DB_PERF_RUN_ID: "current-run",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(errors).toBe("");
    const report = await Bun.file(join(directory, "provenance.json")).json();
    expect(report.name).toBe("provenance");
    expect(report.runId).toBe("current-run");
    expect(report.rows).toBe(5000);
    expect(Date.parse(report.capturedAt)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(report.capturedAt)).toBeLessThanOrEqual(Date.now());
    expect(output).toContain(JSON.stringify(report));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("performance profiles reject unsupported throttling instead of silently skipping it", () => {
  expect(parsePerformanceArgs([])).toEqual({
    suite: "core",
    engine: "chromium",
    profile: "standard",
    skipBuild: false,
    filter: null,
  });
  expect(
    parsePerformanceArgs(["--suite", "throttle", "--profile", "constrained", "--skip-build"]),
  ).toEqual({
    suite: "throttle",
    engine: "chromium",
    profile: "constrained",
    skipBuild: true,
    filter: null,
  });
  expect(() => parsePerformanceArgs(["--suite", "throttle", "--engine", "webkit"])).toThrow(
    /Chromium/,
  );
  expect(() => parsePerformanceArgs(["--suite", "browser", "--profile", "constrained"])).toThrow(
    /throttle/,
  );
  expect(() => parsePerformanceArgs(["--suite", "missing"])).toThrow(/Invalid/);
  expect(() => parsePerformanceArgs(["--engine"])).toThrow(/Invalid/);
  expect(
    parsePerformanceArgs(["--suite", "browser", "--filter", "palette|onboarding"]).filter,
  ).toBe("palette|onboarding");
  expect(() => parsePerformanceArgs(["--filter"])).toThrow(/Invalid/);
});

test("per-file core runs report the largest peak, summed CPU and every failed file", () => {
  const resources = (peakRssBytes: number, userCpuMs: number) => ({
    peakRssBytes,
    userCpuMs,
    systemCpuMs: 1,
  });
  const combined = combineFileRuns([
    { file: "a.test.ts", exitCode: 0, executedTests: 3, resources: resources(300, 10) },
    { file: "b.test.ts", exitCode: 1, executedTests: 2, resources: resources(500, 20) },
    { file: "c.test.ts", exitCode: 0, executedTests: 4, resources: resources(200, 5) },
  ]);
  expect(combined).toEqual({
    exitCode: 1,
    executedTests: 9,
    resources: { peakRssBytes: 500, userCpuMs: 35, systemCpuMs: 3 },
    failedFiles: ["b.test.ts"],
  });
  const crashed = combineFileRuns([
    { file: "a.test.ts", exitCode: 0, executedTests: 3, resources: resources(300, 10) },
    { file: "b.test.ts", exitCode: 3, executedTests: null, resources: null },
  ]);
  expect(crashed.executedTests).toBeNull();
  expect(crashed.resources).toBeNull();
  expect(crashed.failedFiles).toEqual(["b.test.ts"]);
});

test("budget failures count only when the median of three attempts fails", () => {
  const output = [
    "\u001b[32m(pass)\u001b[0m /about: Wechsel [12.00ms]",
    "(fail) /query: Wechsel, Leerlauf und Scrollen mit 4× CPU-Drosselung [2592.02ms]",
    "(fail) Gruppe > Menü (erster) Klick",
    "noise (pass) not a result",
  ].join("\r\n");
  const outcomes = testOutcomes(output);
  expect([...outcomes]).toEqual([
    ["/about: Wechsel", "pass"],
    ["/query: Wechsel, Leerlauf und Scrollen mit 4× CPU-Drosselung", "fail"],
    ["Gruppe > Menü (erster) Klick", "fail"],
  ]);
  const pattern = new RegExp(
    testNamePattern(["/query: Wechsel 4× [x]", "Gruppe > Menü (erster) Klick"]),
  );
  expect(pattern.test("/query: Wechsel 4× [x]")).toBe(true);
  expect(pattern.test("Gruppe Menü (erster) Klick")).toBe(true);
  expect(pattern.test("Gruppe Menü (erster) Klick extra")).toBe(false);
  const failed = ["a", "b", "c"];
  const rerun = (failures: string[], executedTests: number | null = 3) => ({
    outcomes: new Map(failures.map((name) => [name, "fail" as const])),
    executedTests,
  });
  expect(confirmedFailures(failed, [rerun([]), rerun(["b"])])).toEqual(["b"]);
  expect(confirmedFailures(failed, [rerun([]), rerun([])])).toEqual([]);
  expect(confirmedFailures(failed, [rerun([]), rerun([], 2)])).toEqual(failed);
  expect(confirmedFailures(failed, [rerun([]), rerun([], null)])).toEqual(failed);
});
