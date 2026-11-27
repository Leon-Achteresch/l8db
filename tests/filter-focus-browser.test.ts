import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const HOTKEY = "ControlOrMeta+g";
const cell = (page: Page) => page.getByText("5880", { exact: true });
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);

afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(query: string) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1140, height: 680 },
  });
  await context.addInitScript(() => {
    const invokes: string[] = [];
    Object.assign(window, {
      invokes,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          invokes.push(command);
          return [];
        },
      },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/tests/fixtures/filter-bar.html?theme=light&${query}`);
  await cell(page).waitFor();
  return { page, context, errors };
}

const active = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return {
      label: element?.getAttribute("aria-label") ?? "",
      tag: element?.tagName ?? "",
      role: element?.getAttribute("role") ?? "",
      editor: element?.classList.contains("cm-content") ?? false,
      inFilter: element?.closest("[data-filter-focus]") !== null,
      popover: document.querySelector("[data-radix-popper-content-wrapper]") !== null,
    };
  });

async function pressFromGrid(page: Page) {
  await cell(page).click();
  await page.keyboard.press(HOTKEY);
  await page.waitForFunction(
    () =>
      document.activeElement?.closest("[data-filter-focus]") ||
      document.querySelector("[data-radix-popper-content-wrapper]"),
  );
  return active(page);
}

run(
  "Mod+G focuses the filter input of every bar style in its current mode",
  async () => {
    const cases: [string, (state: Awaited<ReturnType<typeof active>>) => void][] = [
      ["style=omnibar", (s) => expect(s.label).toBe("Filter eingeben oder KI fragen")],
      ["style=omnibar&filterMode=sql", (s) => expect(s.editor).toBe(true)],
      ["style=classic", (s) => expect(s.tag).toBe("INPUT")],
      ["style=classic&filterMode=sql", (s) => expect(s.editor).toBe(true)],
      ["style=pills", (s) => expect(s.popover).toBe(true)],
      ["style=pills&filterMode=sql", (s) => expect(s.editor).toBe(true)],
    ];
    for (const [query, check] of cases) {
      const { page, context, errors } = await fixture(query);
      try {
        const state = await pressFromGrid(page);
        check(state);
        if (!state.popover) expect(state.inFilter).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  },
  60_000,
);

run(
  "Mod+G inside the classic filter panel collapses it, from the grid reopens it",
  async () => {
    for (const query of ["style=classic", "style=classic&filterMode=sql"]) {
      const { page, context, errors } = await fixture(query);
      try {
        expect((await pressFromGrid(page)).inFilter).toBe(true);
        const started = Date.now();
        await page.keyboard.press(HOTKEY);
        await page.waitForFunction(
          () => !document.querySelector("[data-filter-focus] input, .cm-content"),
        );
        expect(Date.now() - started).toBeLessThan(500);
        expect((await active(page)).inFilter).toBe(false);
        expect((await pressFromGrid(page)).inFilter).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  },
  30_000,
);

run(
  "a saved per-table filter mode wins over the default setting",
  async () => {
    const { page, context } = await fixture("style=classic&filterMode=sql&late=1");
    try {
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      expect(await page.getByRole("tab", { name: "Einfach" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    } finally {
      await context.close();
    }
    const fresh = await fixture("style=classic&filterMode=sql");
    try {
      await fresh.page.getByRole("button", { name: "Filter", exact: true }).click();
      expect(
        await fresh.page
          .getByRole("tab", { name: "SQL", exact: true })
          .getAttribute("aria-selected"),
      ).toBe("true");
    } finally {
      await fresh.context.close();
    }
  },
  30_000,
);

run(
  "Mod+G stays fast, sends no backend requests and leaves editors alone",
  async () => {
    const { page, context, errors } = await fixture("style=omnibar");
    try {
      const before = await page.evaluate(
        () => (window as Window & { invokes?: string[] }).invokes?.length ?? 0,
      );
      const samples: number[] = [];
      for (let index = 0; index < 16; index++) {
        await cell(page).click();
        await page.evaluate(() => {
          (window as Window & { focusLatency?: Promise<number> }).focusLatency =
            new Promise<number>((resolve, reject) => {
              let started = 0;
              const timeout = setTimeout(() => reject(new Error("no focus")), 3000);
              document.addEventListener("keydown", () => (started = performance.now()), {
                capture: true,
                once: true,
              });
              document.addEventListener(
                "focusin",
                () => {
                  clearTimeout(timeout);
                  resolve(performance.now() - started);
                },
                { once: true },
              );
            });
        });
        await page.keyboard.press(HOTKEY);
        samples.push(
          (await page.evaluate(
            () => (window as Window & { focusLatency?: Promise<number> }).focusLatency,
          )) as number,
        );
      }
      const latency = interactionPercentiles(samples.slice(1));
      const after = await page.evaluate(
        () => (window as Window & { invokes?: string[] }).invokes?.length ?? 0,
      );
      const targets = await page.locator("[data-filter-focus]").count();

      await page.getByRole("button", { name: "SQL", exact: true }).click();
      const editor = page.locator(".cm-content");
      await editor.click();
      await editor.pressSequentially("id = 1");
      await page.keyboard.press(HOTKEY);
      expect(await editor.textContent()).toBe("id = 1");
      expect(await editor.evaluate((el) => el === document.activeElement)).toBe(true);

      await reportScenario("filter-focus-hotkey", {
        presses: samples.length,
        latency,
        backendRequests: after - before,
        focusTargets: targets,
      });
      expect(after - before).toBe(0);
      expect(targets).toBeLessThanOrEqual(1);
      expect(latency.medianMs).toBeLessThan(50);
      expect(latency.p95Ms).toBeLessThan(120);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  45_000,
);
