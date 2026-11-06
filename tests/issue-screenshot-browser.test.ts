import { expect, setDefaultTimeout, test } from "bun:test";
import { chromium, webkit } from "playwright";

const ENABLED = Boolean(process.env.L8DB_ISSUE_SCREENSHOT_BROWSER);
const ENGINE = process.env.L8DB_ISSUE_SCREENSHOT_BROWSER === "webkit" ? webkit : chromium;
const HIDDEN = 6000;
const HUGE = 20000;
const ROWS = 400;
const COLUMNS = 8;
const RUNS = 9;
const MARK_P95_MS = 60;
const CAPTURE_MS = 1000;
const BLOCK_MS = 400;
const MAX_PNG_BASE64 = 4_000_000;

setDefaultTimeout(60000);

function percentile(values: number[], share: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

async function bundle() {
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/fixtures/issue-screenshot-entry.ts`],
    format: "iife",
  });
  const script = await build.outputs[0]?.text();
  if (!script) throw new Error("bundle failed");
  return script;
}

async function capture(page: import("playwright").Page) {
  return page.evaluate(async () => {
    const api = (
      window as unknown as { issueScreenshot: typeof import("../src/lib/issue-screenshot") }
    ).issueScreenshot;
    const native = window.getComputedStyle;
    let longest = 0;
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    const started = performance.now();
    const png = await api.captureRedactedScreenshot().catch(() => null);
    const captureMs = performance.now() - started;
    longest = Math.max(longest, performance.now() - last);
    clearInterval(tick);
    return {
      captureMs,
      longest,
      png: png?.slice(0, 11) ?? null,
      pngLength: png?.length ?? 0,
      restored: window.getComputedStyle === native,
      leftover:
        document.querySelectorAll("[data-l8db-redact]").length +
        (document.getElementById("l8db-redact-style") ? 1 : 0),
      nodes: document.querySelectorAll("*").length,
    };
  });
}

test.skipIf(!ENABLED)(
  "redacts sensitive screen content quickly and leaves the page untouched",
  async () => {
    const script = await bundle();
    const browser = await ENGINE.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const header = Array.from({ length: COLUMNS }, (_, c) => `<th>spalte_${c}</th>`).join("");
      const row = (r: number) =>
        `<tr>${Array.from({ length: COLUMNS }, (_, c) => `<td>kunde-${r}-${c}@firma.de</td>`).join("")}</tr>`;
      await page.setContent(`<!doctype html><html><head></head><body>
      <h1>prod-db.intern</h1>
      <label>Host <input value="db.intern:5432"></label><kbd>Ctrl</kbd>
      <canvas width="40" height="40"></canvas><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <div contenteditable="true">SELECT * FROM kunden</div>
      <table><thead><tr>${header}</tr></thead><tbody>${Array.from({ length: ROWS }, (_, r) => row(r)).join("")}</tbody></table>
      <div style="display:contents"><p id="contents">sichtbar</p></div>
      <div hidden>${Array.from({ length: HIDDEN }, (_, i) => `<div><span>versteckt-${i}</span></div>`).join("")}</div>
      <div id="ai-workspace">Chat-Verlauf</div>
    </body></html>`);
      await page.addScriptTag({ content: script });
      const result = await page.evaluate(
        async ({ runs }) => {
          const api = (
            window as unknown as { issueScreenshot: typeof import("../src/lib/issue-screenshot") }
          ).issueScreenshot;
          const durations: number[] = [];
          let marked = 0;
          for (let run = 0; run < runs; run++) {
            const started = performance.now();
            marked = api.markSensitive(document.body);
            durations.push(performance.now() - started);
            if (run < runs - 1) api.unmarkSensitive(document.body);
          }
          const flag = (selector: string) =>
            document.querySelector(selector)?.hasAttribute("data-l8db-redact");
          const checks = {
            cells: [...document.querySelectorAll("td")].every((cell) =>
              cell.hasAttribute("data-l8db-redact"),
            ),
            cellColor: getComputedStyle(document.querySelector("td") as Element).color,
            header: flag("th"),
            heading: flag("h1"),
            label: flag("label"),
            input: flag("input"),
            canvas: flag("canvas"),
            image: flag("img"),
            editable: flag("[contenteditable]"),
            kbd: flag("kbd"),
          };
          api.unmarkSensitive(document.body);
          return { durations, marked, checks };
        },
        { runs: RUNS },
      );
      const shot = await capture(page);
      const median = percentile(result.durations, 0.5);
      const p95 = percentile(result.durations, 0.95);
      console.log(
        `issue screenshot (${ENGINE.name()}): ${shot.nodes} elements, ${result.marked} marked, mark median ${median.toFixed(1)} ms p95 ${p95.toFixed(1)} ms, capture ${shot.captureMs.toFixed(0)} ms, longest block ${shot.longest.toFixed(0)} ms, png ${(shot.pngLength / 1024).toFixed(0)} KiB base64`,
      );
      expect(result.checks).toEqual({
        cells: true,
        cellColor: "rgba(0, 0, 0, 0)",
        header: false,
        heading: true,
        label: false,
        input: true,
        canvas: true,
        image: true,
        editable: true,
        kbd: false,
      });
      expect(result.marked).toBeGreaterThanOrEqual(ROWS * COLUMNS);
      expect(p95).toBeLessThan(MARK_P95_MS);
      expect(shot.png).toBe("iVBORw0KGgo");
      expect(shot.pngLength).toBeLessThan(MAX_PNG_BASE64);
      expect(shot.captureMs).toBeLessThan(CAPTURE_MS);
      expect(shot.longest).toBeLessThan(BLOCK_MS);
      expect(shot.restored).toBe(true);
      expect(shot.leftover).toBe(0);
    } finally {
      await browser.close();
    }
  },
);

test.skipIf(!ENABLED)("gives up on a huge visible page instead of freezing it", async () => {
  const script = await bundle();
  const browser = await ENGINE.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(`<!doctype html><html><head></head><body>
      <div style="display:grid;grid-template-columns:repeat(200,7px);font-size:4px">${Array.from({ length: HUGE }, (_, i) => `<span>${i}</span>`).join("")}</div>
    </body></html>`);
    await page.addScriptTag({ content: script });
    const shot = await capture(page);
    console.log(
      `issue screenshot huge (${ENGINE.name()}): ${shot.nodes} elements, capture ${shot.captureMs.toFixed(0)} ms, longest block ${shot.longest.toFixed(0)} ms, png ${shot.png ? "yes" : "skipped"}`,
    );
    expect(shot.captureMs).toBeLessThan(CAPTURE_MS * 2);
    expect(shot.longest).toBeLessThan(CAPTURE_MS * 2);
    expect(shot.restored).toBe(true);
    expect(shot.leftover).toBe(0);
  } finally {
    await browser.close();
  }
});
