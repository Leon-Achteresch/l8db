import { resolve } from "node:path";
import { type CDPSession, chromium, type Page } from "playwright";
import { seedApp } from "../tests/fixtures/perf-app";

type TraceEvent = {
  name: string;
  ph: string;
  dur?: number;
  ts: number;
  cat: string;
  args?: { data?: { functionName?: string; url?: string; lineNumber?: number; type?: string } };
};

const STACK_LEAVES = (
  process.env.PROBE_LEAVES ?? "getBoundingClientRect,get scrollLeft,setAttribute"
).split(",");
const DIST = process.env.PROBE_DIST ?? "dist";

const WATCHED = [
  "RunTask",
  "FunctionCall",
  "EvaluateScript",
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "Layerize",
  "Commit",
  "MinorGC",
  "MajorGC",
  "HitTest",
  "ParseAuthorStyleSheet",
];

async function trace(cdp: CDPSession, run: () => Promise<void>) {
  const events: TraceEvent[] = [];
  const onData = (payload: { value: TraceEvent[] }) => events.push(...payload.value);
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: ["devtools.timeline", "v8", "blink.user_timing"] },
  });
  await run();
  const done = new Promise<void>((resolveDone) =>
    cdp.once("Tracing.tracingComplete", () => resolveDone()),
  );
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  const calls = new Map<string, { ms: number; count: number }>();
  for (const event of events) {
    if (
      event.ph !== "X" ||
      !["FunctionCall", "EventDispatch", "TimerFire", "FireAnimationFrame"].includes(event.name)
    )
      continue;
    const data = event.args?.data;
    const key = `${event.name} ${data?.type ?? ""} ${data?.functionName ?? ""}@${data?.url?.split("/").pop() ?? ""}:${data?.lineNumber ?? ""}`;
    const entry = calls.get(key) ?? { ms: 0, count: 0 };
    entry.ms += (event.dur ?? 0) / 1000;
    entry.count += 1;
    calls.set(key, entry);
  }
  for (const [key, entry] of [...calls.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 22))
    console.log(
      `CALL ${entry.ms.toFixed(1).padStart(8)} ms n=${String(entry.count).padStart(6)}  ${key}`,
    );
  const totals: Record<string, { ms: number; count: number; worst: number }> = {};
  for (const event of events) {
    if (event.ph !== "X" || !WATCHED.includes(event.name)) continue;
    const ms = (event.dur ?? 0) / 1000;
    const total = (totals[event.name] ??= { ms: 0, count: 0, worst: 0 });
    total.ms += ms;
    total.count += 1;
    total.worst = Math.max(total.worst, ms);
  }
  return totals;
}

async function profile(cdp: CDPSession, run: () => Promise<void>, top = 25) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await run();
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const deltas = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((id, index) => {
    const node = byId.get(id);
    if (!node) return;
    const frame = node.callFrame;
    const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber}:${frame.columnNumber}`;
    self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
  });
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const stacks = new Map<string, number>();
  (profile.samples ?? []).forEach((id, index) => {
    const leaf = byId.get(id);
    if (!leaf || !STACK_LEAVES.includes(leaf.callFrame.functionName)) return;
    const chain: string[] = [];
    let current: number | undefined = id;
    while (current !== undefined && chain.length < 9) {
      const frame = byId.get(current)?.callFrame;
      if (frame)
        chain.push(
          `${frame.functionName || "(anon)"}@${frame.url.split("/").pop()}:${frame.lineNumber}`,
        );
      current = parents.get(current);
    }
    const key = chain.join(" < ");
    stacks.set(key, (stacks.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
  });
  const inclusive = new Map<string, number>();
  (profile.samples ?? []).forEach((id, index) => {
    const seen = new Set<string>();
    let current: number | undefined = id;
    while (current !== undefined) {
      const frame = byId.get(current)?.callFrame;
      const file = frame?.url.split("/").pop() ?? "";
      if (
        frame &&
        file &&
        frame.functionName &&
        (process.env.PROBE_REACT
          ? /^(renderRoot|commitRoot|flushPassive|flushLayout|flushMutation|commitMutationEffects$|commitLayoutEffects$|commitPassive(Mount|Unmount)Effects$|performWorkOnRoot|performSyncWorkOnRoot|flushSpawnedWork|recursivelyTraverseDeletionEffects|commitBeforeMutation|flushSyncWork)/.test(
              frame.functionName,
            )
          : !file.startsWith("startup-react"))
      ) {
        const key = `${frame.functionName} ${file}:${frame.lineNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          inclusive.set(key, (inclusive.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
        }
      }
      current = parents.get(current);
    }
  });
  for (const [key, ms] of [...inclusive.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.PROBE_INCLUSIVE ?? 0)))
    console.log(`INCL ${ms.toFixed(1).padStart(8)} ms  ${key}`);
  for (const [stack, ms] of [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`STACK ${ms.toFixed(1)} ms  ${stack}`);
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

async function clickLatency(page: Page, selector: string, ready: string) {
  return page.evaluate(
    ({ selector, ready }) =>
      new Promise<number>((resolveLatency) => {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) throw new Error(`missing ${selector}`);
        const start = performance.now();
        target.click();
        const check = () => {
          if (document.querySelector(ready))
            requestAnimationFrame(() => resolveLatency(performance.now() - start));
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    { selector, ready },
  );
}

function print(label: string, totals: Awaited<ReturnType<typeof trace>>) {
  console.log(`\n== ${label}`);
  for (const [name, total] of Object.entries(totals).sort((a, b) => b[1].ms - a[1].ms))
    console.log(
      `${name.padEnd(24)} ${total.ms.toFixed(1).padStart(9)} ms  n=${String(total.count).padStart(6)}  worst ${total.worst.toFixed(1)} ms`,
    );
}

const rows = Number(process.env.PROBE_ROWS ?? 500);
const columns = Number(process.env.PROBE_COLUMNS ?? 24);
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const pathname = new URL(request.url).pathname;
    const file = Bun.file(resolve(DIST, pathname.replace(/^\//, "")));
    if (pathname !== "/" && (await file.exists())) return new Response(file);
    return new Response(Bun.file(resolve(DIST, "index.html")), {
      headers: { "Content-Type": "text/html" },
    });
  },
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  reducedMotion: process.env.PROBE_REDUCED ? "reduce" : "no-preference",
});
page.on("pageerror", (error) => console.log("pageerror", error.message));
await seedApp(page, 3000, { rows, columns });
await page.addInitScript((rowLimit) => {
  const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
  localStorage.setItem(
    "l8db.settings",
    JSON.stringify({ ...saved, state: { ...saved.state, rowLimit } }),
  );
}, rows);
await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
await page.waitForSelector('tbody tr[data-index="0"]', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.locator('a[data-name="table_0001"]').first().click();
await page.waitForSelector('[role="tab"][title*="table_0001"]');
await page.waitForTimeout(1500);
await page.locator('a[data-name="table_0002"]').first().click();
await page.waitForSelector('[role="tab"][title*="table_0002"]');
await page.waitForTimeout(1500);
const layerCdp = await page.context().newCDPSession(page);
let layerCount = 0;
layerCdp.on("LayerTree.layerTreeDidChange", (payload) => {
  layerCount = payload.layers?.length ?? layerCount;
});
await layerCdp.send("LayerTree.enable");
await page.waitForTimeout(500);
console.log("layers", layerCount);
await layerCdp.send("LayerTree.disable");
console.log(
  "tabs",
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("title")),
  ),
  "nodes",
  await page.evaluate(() => document.querySelectorAll("*").length),
);

if (process.env.PROBE_CSS) await page.addStyleTag({ content: process.env.PROBE_CSS });
const cdp = await page.context().newCDPSession(page);
const tabSelector = (index: number) => `[role="tab"][title*="table_000${index}"]`;
const switchTabs = async (count: number) => {
  const samples: number[] = [];
  for (let step = 0; step < count; step++) {
    const index = step % 3;
    samples.push(
      await clickLatency(page, tabSelector(index), `${tabSelector(index)}[aria-selected="true"]`),
    );
    await page.waitForTimeout(Number(process.env.PROBE_WAIT ?? 350));
  }
  return samples.sort((a, b) => a - b);
};
if (!process.env.PROBE_SKIP_TABS) {
  await switchTabs(6);
  let samples: number[] = [];
  print(
    "tab switch x18 (trace)",
    await trace(cdp, async () => void (samples = await switchTabs(18))),
  );
  console.log(
    `latency median ${samples[9].toFixed(1)} ms, p95 ${samples[17].toFixed(1)} ms, min ${samples[0].toFixed(1)}`,
  );
  console.log("\n== tab switch x18 (JS self time)");
  for (const [name, ms] of await profile(cdp, async () => void (await switchTabs(18))))
    console.log(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
}

const scroll = async () => {
  await page.mouse.move(900, 500);
  for (let step = 0; step < 120; step++) {
    await page.mouse.wheel(step % 40 < 30 ? 0 : 300, step % 20 < 10 ? 400 : -400);
    await page.waitForTimeout(16);
  }
};
await scroll();
print("grid scroll 120 wheel steps (trace)", await trace(cdp, scroll));
console.log("\n== grid scroll (JS self time)");
for (const [name, ms] of await profile(cdp, scroll))
  console.log(`${ms.toFixed(1).padStart(8)} ms  ${name}`);

await browser.close();
server.stop(true);
