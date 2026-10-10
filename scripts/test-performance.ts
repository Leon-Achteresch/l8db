import { appendFile, mkdir } from "node:fs/promises";
import { arch, cpus, release, totalmem } from "node:os";
import { resolve } from "node:path";
import {
  executedTestCount,
  normalizeProcessResources,
  resourceViolations,
} from "./performance-report";

const SUITES = {
  core: [
    "tests/perf-budget.test.ts",
    "tests/query-client.test.ts",
    "tests/query-cache-budget.test.ts",
    "tests/perf-query-cache.test.ts",
    "tests/perf-schema-object-loading.test.ts",
    "tests/virtual-row-model.test.ts",
    "tests/perf-virtual-row-model.test.ts",
    "tests/perf-query-history-format.test.ts",
    "tests/perf-history-modal-boundary.test.ts",
    "tests/perf-virtual-item-measurement.test.ts",
    "tests/observe-virtual-scroll-rect.test.ts",
    "tests/perf-grid-window-range.test.ts",
    "tests/perf-fresh-element-scroll.test.ts",
    "tests/perf-app-requests.test.ts",
    "tests/perf-query-statement-outline.test.ts",
    "tests/perf-dml-preview.test.ts",
    "tests/perf-multi-target.test.ts",
    "tests/perf-multi-target-split.test.ts",
    "tests/perf-usage-statistics.test.ts",
    "tests/perf-usage-statistics-view.test.ts",
    "tests/perf-live-monitor.test.ts",
    "tests/perf-dashboard-bi.test.ts",
    "tests/perf-versioning-pipeline.test.ts",
    "tests/perf-sync.test.ts",
    "tests/perf-connection-import.test.ts",
    "tests/abandoned-jobs.test.ts",
    "tests/performance-report.test.ts",
  ],
  browser: [
    "tests/perf-browser.test.ts",
    "tests/perf-grid-lifecycle.test.ts",
    "tests/perf-grid-row-height.test.ts",
    "tests/perf-bundle.test.ts",
    "tests/perf-app.test.ts",
    "tests/perf-query-history.test.ts",
    "tests/perf-query-history-modal.test.ts",
    "tests/perf-query-navigator.test.ts",
    "tests/perf-query-outline.test.ts",
    "tests/perf-query-members.test.ts",
    "tests/perf-view-editor-metadata.test.ts",
    "tests/perf-monitor-logs.test.ts",
    "tests/perf-segmented-control.test.ts",
    "tests/perf-palette-loading.test.ts",
    "tests/perf-onboarding.test.ts",
  ],
  throttle: ["tests/perf-throttle.test.ts"],
} as const;

export function parsePerformanceArgs(args: string[]) {
  let suite: keyof typeof SUITES = "core";
  let engine: "chromium" | "webkit" = "chromium";
  let profile: "standard" | "constrained" = "standard";
  let skipBuild = false;
  let filter: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--skip-build") skipBuild = true;
    else {
      const value = args[++index];
      if (flag === "--suite" && (value === "core" || value === "browser" || value === "throttle"))
        suite = value;
      else if (flag === "--engine" && (value === "chromium" || value === "webkit")) engine = value;
      else if (flag === "--profile" && (value === "standard" || value === "constrained"))
        profile = value;
      else if (flag === "--filter" && value) filter = value;
      else throw new Error(`Invalid performance option: ${flag} ${value ?? ""}`);
    }
  }
  if (suite === "throttle" && engine === "webkit")
    throw new Error("CPU throttling and the JS heap budget require Chromium");
  if (profile === "constrained" && suite !== "throttle")
    throw new Error("The constrained profile requires --suite throttle");
  return { suite, engine, profile, skipBuild, filter };
}

async function run() {
  if (Bun.version !== "1.3.10") throw new Error("Performance reports require Bun 1.3.10");
  const { suite, engine, profile, skipBuild, filter } = parsePerformanceArgs(process.argv.slice(2));
  const directory = resolve(
    process.env.L8DB_PERF_REPORT_DIR ?? `test-artifacts/performance/${suite}-${profile}-${engine}`,
  );
  await mkdir(directory, { recursive: true });
  if (suite !== "core" && !skipBuild) {
    const build = Bun.spawn([process.execPath, "run", "build"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const result = await build.exited;
    if (result !== 0) {
      process.exitCode = result;
      return;
    }
  }
  const command = [
    process.execPath,
    "test",
    ...SUITES[suite],
    ...(filter ? ["--test-name-pattern", filter] : []),
  ];
  const limits = {
    peakRssBytes: (suite === "core" ? 512 : 1024) * 1024 * 1024,
    cpuMs: (suite === "core" ? 30 : 600) * 1000,
  };
  const cpuRate = profile === "constrained" ? 4 : 1;
  const heapLimitMb = profile === "constrained" ? 256 : 512;
  const log = resolve(directory, "tests.log");
  await Bun.write(log, "");
  const runId = crypto.randomUUID();
  const started = performance.now();
  const child = Bun.spawn(command, {
    env: {
      ...process.env,
      L8DB_PERF_REPORT_DIR: directory,
      L8DB_PERF_RUN_ID: runId,
      L8DB_PERF_ENGINE: engine,
      L8DB_PERF_BROWSER: suite === "browser" ? "1" : "",
      L8DB_PERF_APP: suite === "browser" ? "1" : "",
      L8DB_PERF_STYLED: "1",
      L8DB_PERF_THROTTLE: suite === "throttle" ? "1" : "",
      L8DB_PERF_CPU_RATE: String(cpuRate),
      L8DB_PERF_HEAP_LIMIT_MB: String(heapLimitMb),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: suite === "core" ? 60_000 : 900_000,
  });
  let outputTail = "";
  const capture = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      process.stdout.write(chunk);
      outputTail = (outputTail + decoder.decode(chunk, { stream: true })).slice(-16_384);
      await appendFile(log, chunk);
    }
  };
  const [exitCode] = await Promise.all([
    child.exited,
    capture(child.stdout),
    capture(child.stderr),
  ]);
  const wallMs = performance.now() - started;
  const usage = child.resourceUsage();
  const resources = usage ? normalizeProcessResources(usage, process.platform) : null;
  const violations = resources
    ? resourceViolations(resources, limits)
    : ["Resource usage unavailable"];
  const executedTests = executedTestCount(outputTail);
  if (executedTests === null) violations.push("Executed test count was not reported");
  else if (executedTests === 0) violations.push("No tests executed");
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
  const dirty = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.length > 0;
  const report = {
    version: 1,
    runId,
    capturedAt: new Date().toISOString(),
    revision,
    dirty,
    suite,
    profile,
    filter,
    engine: suite === "core" ? null : engine,
    hardware: {
      platform: process.platform,
      architecture: arch(),
      kernel: release(),
      cpu: cpus()[0]?.model ?? null,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
    },
    runtime: Bun.version,
    command,
    cpuRate: suite === "throttle" ? cpuRate : null,
    heapLimitMb: suite === "throttle" ? heapLimitMb : null,
    wallMs,
    resources,
    resourceScope:
      "OS resource usage for the test subprocess; not a summed application process tree",
    limits,
    exitCode,
    executedTests,
    signal: child.signalCode,
    violations,
  };
  await Bun.write(resolve(directory, "resources.json"), JSON.stringify(report, null, 2));
  console.log(`Performance report: ${directory}`);
  for (const violation of violations) console.error(violation);
  process.exitCode = exitCode === 0 && violations.length === 0 ? 0 : 1;
}

if (import.meta.main) await run();
