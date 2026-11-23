import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
type Range = { startLine: number; endLine: number };
type Timing = { runs: number; medianMs: number; p95Ms: number };
type Fixture = {
  source: string;
  ready: Promise<void>;
  read: () => string;
  visible: () => string;
  hidden: () => Range[];
  checked: () => boolean;
  openEditors: () => number;
  type: (text: string) => void;
  moveTo: (line: number) => void;
  copy: () => string;
  switchTab: (index: number) => void;
  disable: () => Promise<void>;
  perf: (
    lines: number,
    count: number,
  ) => { lines: number; ranges: number; setHiddenRanges: Timing; typing: Timing };
};
type Host = Window & {
  extensionEditorFixture: Fixture;
  invokeCalls: { command: string; args: string }[];
};
const LOGS = [
  { startLine: 2, endLine: 2 },
  { startLine: 4, endLine: 5 },
];

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

const fixture = <T>(page: Page, read: (fixture: Fixture) => T | Promise<T>) =>
  page.evaluate(`(${read})(window.extensionEditorFixture)`) as Promise<T>;
const toggle = (page: Page) => page.getByRole("button", { name: "Logs ausblenden", exact: true });
const markers = (page: Page) => page.locator(".extension-hidden-marker");

async function open() {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1180, height: 640 },
  });
  await context.addInitScript(() => {
    const calls: { command: string; args: string }[] = [];
    Object.assign(window, {
      invokeCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args: JSON.stringify(args ?? null) });
          return /^(execute_|run_|stream_)/.test(command)
            ? {
                columns: ["wert"],
                rows: [{ wert: "1" }],
                rows_affected: null,
                execution_time_ms: 1,
              }
            : [];
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7500);
  await page.goto(`${url}/tests/fixtures/extension-editor.html`, { timeout: 45_000 });
  await page.locator("[data-fixture-query] .monaco-editor").first().waitFor();
  await fixture(page, (host) => host.ready);
  await toggle(page).waitFor();
  return { context, page };
}

run(
  "toolbar toggle hides log statements in the view while run, copy and the model keep the full text",
  async () => {
    const { context, page } = await open();
    try {
      const source = await fixture(page, (host) => host.source);
      expect(await toggle(page).getAttribute("aria-pressed")).toBe("false");
      expect(await fixture(page, (host) => host.visible())).toContain("PRINT");

      await toggle(page).click();
      await page.waitForFunction(() => (window as Host).extensionEditorFixture.checked());
      expect(await toggle(page).getAttribute("aria-pressed")).toBe("true");
      expect(await fixture(page, (host) => host.hidden())).toEqual(LOGS);
      await markers(page).first().waitFor();
      expect(
        (await markers(page).allInnerTexts()).map((text) => text.replaceAll("\u00a0", " ")),
      ).toEqual(["⋯ 1 Zeile ausgeblendet", "⋯ 2 Zeilen ausgeblendet"]);
      const visible = await fixture(page, (host) => host.visible());
      expect(visible).not.toContain("PRINT");
      expect(visible).toContain("SELECT name FROM kunde");
      expect(await fixture(page, (host) => host.read())).toBe(source);
      expect(await fixture(page, (host) => host.copy())).toBe(source);
      await mkdir("test-artifacts/browser", { recursive: true });
      await page.screenshot({ path: "test-artifacts/browser/extension-editor-toolbar.png" });

      await fixture(page, (host) => host.type("-- neu\n"));
      await page.waitForFunction(
        () => (window as Host).extensionEditorFixture.hidden()[0]?.startLine === 3,
      );
      expect(await fixture(page, (host) => host.hidden())).toEqual([
        { startLine: 3, endLine: 3 },
        { startLine: 5, endLine: 6 },
      ]);
      expect(await fixture(page, (host) => host.read())).toBe(`-- neu\n${source}`);

      await markers(page).first().click();
      await page.waitForFunction(
        () => (window as Host).extensionEditorFixture.hidden().length === 1,
      );
      expect(await fixture(page, (host) => host.visible())).toContain("konto gelesen");
      expect(await markers(page).count()).toBe(1);
      expect(await fixture(page, (host) => host.visible())).not.toContain("debug: kunde");

      await page.locator('[data-tour="query-run"]').click();
      await page.waitForFunction(() =>
        (window as Host).invokeCalls.some((call) => call.args.includes("fertig")),
      );
      const sent = await page.evaluate(() =>
        (window as Host).invokeCalls
          .filter((call) => /^(execute_|run_|stream_)/.test(call.command))
          .map((call) => call.args),
      );
      for (const statement of [
        "konto WHERE id = 42",
        "debug: konto gelesen",
        "debug: kunde",
        "gelesen')",
        "AS fertig",
      ])
        expect(sent.some((args) => args.includes(statement))).toBe(true);

      await fixture(page, (host) => host.moveTo(5));
      await page.waitForFunction(
        () => (window as Host).extensionEditorFixture.hidden().length === 0,
      );
      await page.waitForFunction(() =>
        (window as Host).extensionEditorFixture.visible().includes("debug: kunde"),
      );
      expect(await markers(page).count()).toBe(0);

      await fixture(page, (host) => host.disable());
      await page.waitForFunction(
        () => (window as Host).extensionEditorFixture.hidden().length === 0,
      );
      expect(await fixture(page, (host) => host.checked())).toBe(false);
      await page.waitForFunction(() => !document.querySelector(".extension-hidden-marker"));
      expect(await toggle(page).count()).toBe(0);
      expect(await fixture(page, (host) => host.visible())).toContain("kunde ',");
    } finally {
      await context.close();
    }
  },
  60_000,
);

run(
  "switching the tab releases the editor state and 3,000 ranges in 10,000 lines stay responsive",
  async () => {
    const { context, page } = await open();
    try {
      await toggle(page).click();
      await page.waitForFunction(() => (window as Host).extensionEditorFixture.checked());
      await fixture(page, (host) => host.switchTab(1));
      await page.waitForFunction(() =>
        (window as Host).extensionEditorFixture.read().includes("zweiter_tab"),
      );
      expect(await fixture(page, (host) => host.openEditors())).toBe(1);
      expect(await fixture(page, (host) => host.checked())).toBe(false);
      expect(await fixture(page, (host) => host.hidden())).toEqual([]);
      expect(await markers(page).count()).toBe(0);
      expect(await toggle(page).getAttribute("aria-pressed")).toBe("false");

      const measured = await fixture(page, (host) => host.perf(10_000, 3_000));
      console.log(
        `performance extension-editor-browser: ${JSON.stringify({
          ...measured,
          environment: {
            os: platform(),
            arch: arch(),
            cpu: cpus()[0]?.model,
            ramBytes: totalmem(),
            browser: browser.version(),
          },
        })}`,
      );
      expect(measured.setHiddenRanges.medianMs).toBeLessThan(25);
      expect(measured.setHiddenRanges.p95Ms).toBeLessThan(50);
      expect(measured.typing.medianMs).toBeLessThan(25);
      expect(measured.typing.p95Ms).toBeLessThan(50);
    } finally {
      await context.close();
    }
  },
  90_000,
);
