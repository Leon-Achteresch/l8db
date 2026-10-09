import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  executedTestCount,
  normalizeProcessResources,
  resourceViolations,
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
