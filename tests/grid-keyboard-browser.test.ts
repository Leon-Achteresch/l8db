import { afterAll, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { chromium, webkit } from "playwright";

const URL = process.env.L8DB_TABLE_BROWSER_URL;
const engine = () => (process.env.L8DB_GRID_ENGINE === "webkit" ? webkit : chromium);
let browser: Browser | undefined;

afterAll(async () => {
  await browser?.close();
});

async function open(rows = 12) {
  browser ??= await engine().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: async () => [] };
  });
  await page.goto(`${URL}/tests/fixtures/table-edit.html?rows=${rows}`);
  await page.locator('tbody tr[data-index="0"] td[data-col="email"]').waitFor();
  return { page, errors };
}

const active = async (page: Page) => {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return page.evaluate(() => {
    const cells = document.querySelectorAll<HTMLElement>("td.outline-primary\\/70");
    if (cells.length !== 1) return cells.length === 0 ? null : `multiple:${cells.length}`;
    return `${cells[0].dataset.rowIndex}:${cells[0].dataset.col}`;
  });
};

const focusInGrid = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest("[data-grid-scroll]"));

const cell = (page: Page, row: number, col: string) =>
  page.locator(`tbody tr[data-index="${row}"] td[data-col="${col}"]`);

test.skipIf(!URL)(
  "grid keyboard: active cell and focus survive edit, cancel and outside Escape",
  async () => {
    const { page, errors } = await open();
    try {
      await cell(page, 1, "email").click();
      expect(await active(page)).toBe("1:email");
      await page.keyboard.press("Enter");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      await input.fill("changed@example.test");
      await page.keyboard.press("Enter");
      await page.getByText("changed@example.test", { exact: true }).waitFor();
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("1:email");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("2:email");

      await page.keyboard.press("F2");
      await input.waitFor();
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("2:email");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("ArrowRight");
      expect(await active(page)).toBe("2:city");

      await page.evaluate(() => {
        const button = document.createElement("button");
        button.id = "outside";
        button.textContent = "outside";
        document.body.prepend(button);
      });
      await page.locator("#outside").focus();
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("2:city");
      await cell(page, 3, "id").click();
      await page.keyboard.press("ArrowUp");
      expect(await active(page)).toBe("2:id");
      expect(await page.evaluate(() => window.testSaves.length)).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "grid keyboard: type-to-edit, Tab, Home/End, Mod+Arrow, Mod+Home/End, Shift+Arrow, Mod+A",
  async () => {
    const { page, errors } = await open();
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    try {
      await cell(page, 0, "email").click();
      await page.keyboard.type("x");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      expect(await input.inputValue()).toBe("x");
      await page.keyboard.type("@y.test");
      await page.keyboard.press("Tab");
      await input.waitFor({ state: "detached" });
      expect(await page.evaluate(() => window.testSaves.at(-1))).toMatchObject({
        ctid: "(0,1)",
        updates: { email: "x@y.test" },
      });
      expect(await active(page)).toBe("0:city");
      expect(await focusInGrid(page)).toBe(true);

      await page.keyboard.press("Home");
      expect(await active(page)).toBe("0:id");
      await page.keyboard.press("End");
      expect(await active(page)).toBe("0:city");
      await page.keyboard.press(`${mod}+ArrowDown`);
      expect(await active(page)).toBe("11:city");
      await page.keyboard.press(`${mod}+ArrowLeft`);
      expect(await active(page)).toBe("11:id");
      await page.keyboard.press(`${mod}+Home`);
      expect(await active(page)).toBe("0:id");
      await page.keyboard.press(`${mod}+End`);
      expect(await active(page)).toBe("11:city");

      await page.keyboard.press("Shift+ArrowUp");
      await page.keyboard.press("Shift+ArrowLeft");
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(3);
      await page.keyboard.press(`${mod}+a`);
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(35);
      await page.keyboard.press("Escape");
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(0);
      expect(await active(page)).not.toBeNull();

      await cell(page, 3, "city").click();
      await page.keyboard.press("Shift+Tab");
      expect(await active(page)).toBe("3:email");
      await page.keyboard.press("Tab");
      expect(await active(page)).toBe("3:city");
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "grid keyboard perf: arrow navigation over 5000 rows stays fast with bounded DOM",
  async () => {
    const { page, errors } = await open(5000);
    try {
      await cell(page, 0, "email").click();
      const timings: number[] = [];
      for (let i = 0; i < 60; i++) {
        const key = i % 20 === 19 ? "PageDown" : "ArrowDown";
        const started = await page.evaluate(() => performance.now());
        await page.keyboard.press(key);
        timings.push(
          await page.evaluate(
            (s) =>
              new Promise<number>((resolve) =>
                requestAnimationFrame(() => resolve(performance.now() - s)),
              ),
            started,
          ),
        );
      }
      const row = Number((await active(page))?.split(":")[0]);
      expect(row).toBeGreaterThan(57);
      expect(await cell(page, row, "email").isVisible()).toBe(true);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
      expect(await active(page)).toBe("4999:city");
      expect(await cell(page, 4999, "city").isVisible()).toBe(true);
      const rendered = await page.locator("tbody tr").count();
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
      console.log(
        `grid keyboard nav 5000 rows: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, rendered rows ${rendered}`,
      );
      expect(p95).toBeLessThan(100);
      expect(rendered).toBeLessThan(150);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

const CONSOLE_NOISE = /favicon|Download the React DevTools/;

async function openGrid(rows = 12) {
  browser ??= await engine().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !CONSOLE_NOISE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: async () => [] };
  });
  await page.goto(`${URL}/tests/fixtures/table-edit.html?rows=${rows}`);
  await page.locator('tbody tr[data-index="0"] td[data-col="email"]').waitFor();
  return { page, errors };
}

const modKey = process.platform === "darwin" ? "Meta" : "Control";

const inViewport = (page: Page, row: number, col: string) =>
  page.evaluate(
    ([r, c]) => {
      const el = document.querySelector<HTMLElement>(
        `tbody td[data-row-index="${r}"][data-col="${c}"]`,
      );
      const scroll = document.querySelector<HTMLElement>("[data-grid-scroll]");
      if (!el || !scroll) return false;
      const a = el.getBoundingClientRect();
      const b = scroll.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    },
    [row, col] as const,
  );

const pageErrors = (errors: string[]) => expect(errors).toEqual([]);

test.skipIf(!URL)(
  "matrix a: Enter, change text, Enter, ArrowDown moves exactly one row",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 4, "city").click();
      await page.keyboard.press("Enter");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      await input.fill("Dresden");
      await page.keyboard.press("Enter");
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("4:city");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("5:city");
      expect(await focusInGrid(page)).toBe(true);
      expect(await page.evaluate(() => window.testSaves.at(-1))).toMatchObject({
        updates: { city: "Dresden" },
      });
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix b: Enter, Escape, ArrowRight moves exactly one column",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 2, "email").click();
      await page.keyboard.press("Enter");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("2:email");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("ArrowRight");
      expect(await active(page)).toBe("2:city");
      expect(await focusInGrid(page)).toBe(true);
      expect(await page.evaluate(() => window.testSaves.length)).toBe(0);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix c: F2 starts editing and typing a letter starts editing with exactly that letter",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 3, "email").click();
      await page.keyboard.press("F2");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("3:email");

      await cell(page, 6, "city").click();
      await page.keyboard.press("k");
      await input.waitFor();
      expect(await input.inputValue()).toBe("k");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      expect(await page.evaluate(() => window.testSaves.length)).toBe(0);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix d: Tab and Shift+Tab without editing, Tab during editing commits and moves, outer edges release Tab",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 2, "id").click();
      await page.keyboard.press("Tab");
      expect(await active(page)).toBe("2:email");
      await page.keyboard.press("Shift+Tab");
      expect(await active(page)).toBe("2:id");
      expect(await focusInGrid(page)).toBe(true);

      await cell(page, 2, "email").click();
      await page.keyboard.press("Enter");
      const input = page.locator("tbody input").first();
      await input.waitFor();
      await input.fill("tab@example.test");
      await page.keyboard.press("Tab");
      await input.waitFor({ state: "detached" });
      expect(await active(page)).toBe("2:city");
      expect(await focusInGrid(page)).toBe(true);
      expect(await page.evaluate(() => window.testSaves.at(-1))).toMatchObject({
        updates: { email: "tab@example.test" },
      });

      await cell(page, 2, "city").click();
      await page.keyboard.press("Tab");
      expect(await active(page)).toBe("3:id");
      expect(await focusInGrid(page)).toBe(true);

      await cell(page, 2, "email").click();
      await page.keyboard.press("Shift+Tab");
      expect(await active(page)).toBe("2:id");
      await page.keyboard.press("Shift+Tab");
      expect(await active(page)).toBe("1:city");
      expect(await focusInGrid(page)).toBe(true);

      await cell(page, 0, "id").click();
      await page.keyboard.press("Shift+Tab");
      expect(await active(page)).toBe("0:id");
      await cell(page, 11, "city").click();
      await page.keyboard.press("Tab");
      expect(await active(page)).toBe("11:city");
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix e: Home, End, Mod+Home/End and Mod+Arrow in all four directions",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 5, "email").click();
      await page.keyboard.press("Home");
      expect(await active(page)).toBe("5:id");
      await page.keyboard.press("End");
      expect(await active(page)).toBe("5:city");
      await page.keyboard.press("Home");
      await page.keyboard.press(`${modKey}+ArrowRight`);
      expect(await active(page)).toBe("5:city");
      await page.keyboard.press(`${modKey}+ArrowLeft`);
      expect(await active(page)).toBe("5:id");
      await page.keyboard.press(`${modKey}+ArrowUp`);
      expect(await active(page)).toBe("0:id");
      await page.keyboard.press(`${modKey}+ArrowRight`);
      expect(await active(page)).toBe("0:city");
      await page.keyboard.press(`${modKey}+ArrowDown`);
      expect(await active(page)).toBe("11:city");
      await page.keyboard.press(`${modKey}+Home`);
      expect(await active(page)).toBe("0:id");
      await page.keyboard.press(`${modKey}+End`);
      expect(await active(page)).toBe("11:city");
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix f: Shift+Arrow extends selection, plain arrow clears it, Mod+A selects all",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 2, "email").click();
      await page.keyboard.press("Shift+ArrowDown");
      await page.keyboard.press("Shift+ArrowRight");
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(3);
      await page.keyboard.press("ArrowLeft");
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(0);
      expect(await active(page)).toBe("3:email");
      expect(await focusInGrid(page)).toBe(true);
      await page.keyboard.press(`${modKey}+a`);
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(35);
      await page.keyboard.press("ArrowDown");
      expect(await page.locator("td.bg-primary\\/10").count()).toBe(0);
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix g: PageDown and PageUp with 5000 rows move the active cell and keep it in the viewport",
  async () => {
    const { page, errors } = await openGrid(5000);
    try {
      await cell(page, 0, "email").click();
      await page.keyboard.press("PageDown");
      const down = Number((await active(page))?.split(":")[0]);
      expect(down).toBeGreaterThan(0);
      expect(await inViewport(page, down, "email")).toBe(true);
      await page.keyboard.press("PageDown");
      const down2 = Number((await active(page))?.split(":")[0]);
      expect(down2).toBeGreaterThan(down);
      expect(await inViewport(page, down2, "email")).toBe(true);
      await page.keyboard.press("PageUp");
      const up = Number((await active(page))?.split(":")[0]);
      expect(up).toBeLessThan(down2);
      expect(await inViewport(page, up, "email")).toBe(true);
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix h: 200 ArrowDown presses in a row lose no keystroke",
  async () => {
    const { page, errors } = await openGrid(5000);
    try {
      await cell(page, 0, "email").click();
      for (let i = 0; i < 200; i++) await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("200:email");
      expect(await inViewport(page, 200, "email")).toBe(true);
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  120000,
);

test.skipIf(!URL)(
  "matrix i: arrows at all four edges keep the active cell and throw nothing",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 0, "id").click();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowLeft");
      expect(await active(page)).toBe("0:id");
      await cell(page, 11, "city").click();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowRight");
      expect(await active(page)).toBe("11:city");
      await cell(page, 0, "city").click();
      await page.keyboard.press("ArrowRight");
      expect(await active(page)).toBe("0:city");
      await cell(page, 11, "id").click();
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("11:id");
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix j: arrows and letters in an input outside the grid do not move the active cell or start editing",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 4, "email").click();
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "outside-input";
        document.body.prepend(input);
      });
      await page.locator("#outside-input").focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("q");
      await page.keyboard.press("Enter");
      expect(await active(page)).toBe("4:email");
      expect(await page.locator("tbody input").count()).toBe(0);
      expect(await page.locator("#outside-input").inputValue()).toBe("q");
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix k: Escape on a focused button outside the grid keeps the active cell",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 3, "city").click();
      await page.evaluate(() => {
        const button = document.createElement("button");
        button.id = "outside-button";
        button.textContent = "outside";
        document.body.prepend(button);
      });
      await page.locator("#outside-button").focus();
      await page.keyboard.press("Escape");
      expect(await active(page)).toBe("3:city");
      await page.keyboard.press("ArrowUp");
      expect(await active(page)).toBe("3:city");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("outside-button");
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix l: click cell then arrow works without a second click, also after clicking a column header",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await cell(page, 1, "email").click();
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("2:email");
      await page.locator('th[data-column-id="city"]').click();
      await cell(page, 5, "id").click();
      await page.keyboard.press("ArrowRight");
      expect(await active(page)).toBe("5:email");
      expect(await focusInGrid(page)).toBe(true);
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix r: typing, F2 and Enter on a read-only cell do not open an editor",
  async () => {
    browser ??= await engine().launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = { invoke: async () => [] };
    });
    try {
      await page.goto(`${URL}/tests/fixtures/table-edit.html?readonly=1`);
      await cell(page, 1, "created").waitFor();
      await cell(page, 1, "created").click();
      for (const key of ["x", "F2", "Enter"]) {
        await page.keyboard.press(key);
        expect(await page.locator("tbody input").count()).toBe(0);
        expect(await active(page)).toBe("1:created");
        expect(await focusInGrid(page)).toBe(true);
      }
      await page.keyboard.press("ArrowLeft");
      expect(await active(page)).toBe("1:city");
      expect(await page.evaluate(() => window.testSaves.length)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!URL)(
  "matrix f6: keyboard focus on the grid container selects the first visible cell",
  async () => {
    const { page, errors } = await openGrid();
    try {
      await page.keyboard.press("Tab");
      await page.locator("[data-grid-scroll]").focus();
      expect(await active(page)).toBe("0:id");
      await page.keyboard.press("ArrowDown");
      expect(await active(page)).toBe("1:id");
      pageErrors(errors);
    } finally {
      await page.close();
    }
  },
  60000,
);
