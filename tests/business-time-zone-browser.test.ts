import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Locator, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const raw = "2026-03-08T06:59:59.123456+00:00";
const converted = [
  "2026-03-08 01:59:59.123456 -05:00",
  "2026-03-08 03:00:00.234560 -04:00",
  "2026-11-01 01:30:00.999999 -04:00",
  "2026-11-01 01:30:00.000001 -05:00",
];
type Boundary = { commands: string[]; clipboard: string[] };
const scope = (page: Page) => page.locator('section[aria-label="Tabelle"]');
const opener = (page: Page) => scope(page).getByRole("button", { name: "Weitere Aktionen" });
const gridCell = (page: Page, column: string, row = 0) =>
  scope(page).locator(`tbody [data-col="${column}"]`).nth(row);
const exactCell = (page: Page, column: string, row = 0) =>
  gridCell(page, column, row).locator("span[title]");
const zoneDialog = (page: Page) => page.getByRole("dialog", { name: "Fachliche Zeitzone" });
const zoneInput = (page: Page) => zoneDialog(page).getByRole("textbox", { name: "IANA-Zeitzone" });
const radio = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });
const zoneEntry = (page: Page) =>
  page.getByRole("menuitem", { name: /^Fachliche Zeitzone|^Fachzone ·/ });
const focus = (element: Locator) => element.and(element.page().locator(":focus")).waitFor();
const events = (page: Page) =>
  page.evaluate(() => (window as Window & { timeBoundary: Boundary }).timeBoundary);
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width: number, mysql = false) {
  const context = await browser.newContext({
    colorScheme: width < 500 ? "dark" : "light",
    timezoneId: "Europe/Berlin",
    viewport: { width, height: 760 },
    reducedMotion: "reduce",
  });
  try {
    await context.addInitScript(() => {
      const timeBoundary: Boundary = { commands: [], clipboard: [] };
      Object.assign(window, {
        timeBoundary,
        __TAURI_INTERNALS__: {
          invoke: async (command: string, args?: { text?: string }) => {
            timeBoundary.commands.push(command);
            if (command === "list_providers") return [];
            if (command === "plugin:clipboard-manager|write_text") {
              timeBoundary.clipboard.push(args?.text ?? "");
              return;
            }
            throw Error(`Unexpected IPC: ${command}`);
          },
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/business-time-zone.html${mysql ? "?mysql=1" : ""}`);
    await exactCell(page, "event_at").waitFor();
    return { page, context, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function openTimeMenu(page: Page) {
  await opener(page).press("Enter");
  await page.getByRole("menuitem", { name: /^Zeitdarstellung:/ }).press("ArrowRight");
  await radio(page, "Original").waitFor();
}

async function chooseZone(page: Page) {
  await openTimeMenu(page);
  await zoneEntry(page).press("Enter");
  await zoneDialog(page).waitFor();
  await focus(zoneInput(page));
}

async function chooseMode(page: Page, mode: string) {
  await openTimeMenu(page);
  await radio(page, mode).press("Enter");
  await radio(page, mode).waitFor({ state: "hidden" });
  await focus(opener(page));
}

run(
  "chooses an IANA zone deliberately and shows only proven instants with exact DST and precision",
  async () => {
    const { context, page, errors } = await fixture(1220);
    try {
      const untyped = page.locator(
        'section[aria-label="Query-Ergebnis"] tbody [data-col="unknown_type"]',
      );
      const rawUntyped = await untyped.textContent();
      expect(await exactCell(page, "event_at").textContent()).toBe(raw);
      await chooseZone(page);
      await zoneInput(page).fill("Mars/Olympus");
      await zoneInput(page).press("Enter");
      await zoneDialog(page).getByRole("alert").waitFor();
      expect(await zoneInput(page).getAttribute("aria-invalid")).toBe("true");
      expect(await exactCell(page, "event_at").textContent()).toBe(raw);
      await focus(zoneInput(page));
      await zoneInput(page).fill("America/New_York");
      await zoneInput(page).press("Enter");
      await zoneDialog(page).waitFor({ state: "detached" });
      await focus(opener(page));
      for (const [index, time] of converted.entries()) {
        const value = exactCell(page, "event_at", index);
        expect(await value.textContent()).toBe(time);
        expect(await value.getAttribute("title")).toContain(`${time} · America/New_York`);
      }
      expect(await gridCell(page, "wall_time").textContent()).toBe("2026-11-01 01:30:00");
      expect(await gridCell(page, "text_like").textContent()).toBe(raw);
      expect(await gridCell(page, "event_at", 4).textContent()).toBe("NULL");
      expect(await untyped.textContent()).toBe(rawUntyped);
      expect(await events(page)).toEqual({ commands: [], clipboard: [] });

      await page.reload();
      expect(await exactCell(page, "event_at").textContent()).toBe(converted[0]);
      const startup = await events(page);
      expect(startup.commands.every((command) => command === "list_providers")).toBe(true);
      await chooseZone(page);
      expect(await zoneInput(page).inputValue()).toBe("America/New_York");
      await zoneInput(page).fill("Asia/Kolkata");
      await page.keyboard.press("Escape");
      await zoneDialog(page).waitFor({ state: "detached" });
      await focus(opener(page));
      expect(await exactCell(page, "event_at").textContent()).toBe(converted[0]);
      await chooseMode(page, "UTC");
      expect(await exactCell(page, "event_at").textContent()).toBe("2026-03-08 06:59:59 UTC");
      await chooseMode(page, "Lokale Zeitzone");
      expect(await exactCell(page, "event_at").textContent()).toBe("2026-03-08 07:59:59 +01:00");
      await chooseMode(page, "Original");
      expect(await exactCell(page, "event_at").textContent()).toBe(raw);
      expect(await events(page)).toEqual(startup);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  55_000,
);

run(
  "compact keyboard workflow retains original copy and edit values",
  async () => {
    const { context, page, errors } = await fixture(390);
    try {
      await chooseZone(page);
      const box = await zoneDialog(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      await zoneInput(page).fill("America/New_York");
      const shot = process.env.L8DB_TIME_ZONE_SCREENSHOT;
      if (shot) await page.screenshot({ path: shot });
      await zoneInput(page).press("Enter");
      await zoneDialog(page).waitFor({ state: "detached" });
      await focus(opener(page));
      expect(await exactCell(page, "event_at").getAttribute("title")).toContain(`Original ${raw}`);
      const value = gridCell(page, "event_at");
      await value.click();
      await value.getByTitle("Kopieren", { exact: true }).click();
      expect((await events(page)).clipboard).toEqual([raw]);
      await value.dblclick();
      const edit = scope(page).locator("tbody input");
      expect(await edit.inputValue()).toBe(raw);
      await edit.press("Escape");
      await edit.waitFor({ state: "detached" });
      expect(await page.getByLabel("Test-Speicherauftrag").textContent()).toBe("");
      expect((await events(page)).commands).toEqual(["plugin:clipboard-manager|write_text"]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "providers without proven timezone types keep the existing modes",
  async () => {
    const { context, page, errors } = await fixture(1020, true);
    try {
      await openTimeMenu(page);
      expect(await zoneEntry(page).count()).toBe(0);
      await radio(page, "UTC").press("Enter");
      expect(await exactCell(page, "event_at").textContent()).toBe("2026-03-08 06:59:59 UTC");
      expect(await events(page)).toEqual({ commands: [], clipboard: [] });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  25_000,
);
