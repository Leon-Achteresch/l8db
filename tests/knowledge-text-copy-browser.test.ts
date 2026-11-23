import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import type { AiKnowledge } from "../src/lib/db/ai";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const read = "ai_knowledge_get";
const write = "ai_knowledge_set";
const clipboard = "plugin:clipboard-manager|write_text";
const description = "Nur freigegebene Aufträge.\nGrüße 東京 🧪";
const column = "Eindeutige Belegnummer";
const existing = "Vorhandener Zieltext";
const initial = {
  source: {
    notes: "",
    glossary: [],
    tables: { orders: { description, columns: { id: column } } },
  },
  target: {
    notes: "",
    glossary: [],
    tables: { orders: { description: existing, columns: { id: "Behält den Zielwert" } } },
  },
  empty: { notes: "", glossary: [], tables: {} },
} satisfies Record<string, AiKnowledge>;
type Boundary = { command: string; connectionId?: string; text?: string; knowledge?: AiKnowledge };
type Host = Window & {
  knowledgeFixtureCalls: Boundary[];
  holdKnowledgeRead?: string;
  releaseKnowledgeRead?: () => void;
  knowledgeReadReleased?: boolean;
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width: number, texts: Record<string, AiKnowledge> = initial) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width, height: 720 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript((texts) => {
      const host = window as Host;
      host.knowledgeFixtureCalls = [];
      Object.assign(host, {
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args: { connectionId?: string; text?: string; knowledge?: AiKnowledge },
          ) => {
            host.knowledgeFixtureCalls.push({ command, ...args });
            if (command === "plugin:clipboard-manager|write_text") return;
            const { connectionId, knowledge } = args;
            if (!connectionId) throw Error(`Unexpected fixture IPC: ${command}`);
            if (command === "ai_knowledge_get") {
              if (host.holdKnowledgeRead === connectionId) {
                host.holdKnowledgeRead = undefined;
                await new Promise<void>((resolve) => {
                  host.releaseKnowledgeRead = resolve;
                });
                host.knowledgeReadReleased = true;
              }
              if (!texts[connectionId]) throw Error("Synthetic read failure");
              return texts[connectionId];
            }
            if (command === "ai_knowledge_set" && connectionId === "target" && knowledge) {
              texts[connectionId] = knowledge;
              return knowledge;
            }
            throw Error(`Unexpected fixture IPC: ${command}`);
          },
        },
      });
    }, texts);
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/knowledge-text-copy.html`);
    return { context, page, errors };
  } catch (failure) {
    await context.close();
    throw failure;
  }
}

const dialog = (page: Page) => page.getByRole("dialog");
const summary = (page: Page, name = "orders") =>
  dialog(page)
    .locator("summary")
    .filter({ has: page.getByText(name, { exact: true }) });
const input = (page: Page, name = "orders") =>
  dialog(page).getByRole("textbox", { name: `Beschreibung von ${name}`, exact: true });
const copy = (page: Page, name = "orders") =>
  dialog(page).getByRole("button", { name: `Beschreibung von ${name} kopieren`, exact: true });
const save = (page: Page) => dialog(page).getByRole("button", { name: "Speichern", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as Host).knowledgeFixtureCalls);
const clipboardCalls = async (page: Page) =>
  (await calls(page)).filter((call) => call.command === clipboard);

async function open(page: Page, connection: string) {
  await page.getByRole("menuitem", { name: /^KI-Wissen/ }).press("Enter");
  await dialog(page)
    .getByRole("heading", { name: `KI-Wissen über ${connection}` })
    .waitFor();
}

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "hidden" });
}

run(
  "copies only the chosen field and the other connection keeps its text until manual paste and save",
  async () => {
    const { context, page, errors } = await fixture(390);
    try {
      await open(page, "Quelle");
      await summary(page).press("Enter");
      await input(page).waitFor();
      await copy(page, "orders.id").press("Space");
      await input(page).focus();
      await page.keyboard.press("Tab");
      await copy(page).and(page.locator(":focus")).waitFor();
      await page.keyboard.press("Enter");
      const copied = await clipboardCalls(page);
      expect(copied).toEqual([
        { command: clipboard, text: column },
        { command: clipboard, text: description },
      ]);
      const dimensions = await dialog(page).evaluate((node) => [
        node.clientWidth,
        node.scrollWidth,
      ]);
      expect(dimensions[1]).toBe(dimensions[0]);
      if (process.env.L8DB_KNOWLEDGE_COPY_SCREENSHOT)
        await dialog(page).screenshot({ path: process.env.L8DB_KNOWLEDGE_COPY_SCREENSHOT });
      await input(page).fill("   ");
      expect(await copy(page).isDisabled()).toBe(true);
      await close(page);
      await page.getByLabel("Verbindung").selectOption("target");
      await open(page, "Ziel");
      await summary(page).press("Enter");
      expect(await input(page).inputValue()).toBe(existing);
      await input(page).fill(copied.at(-1)?.text ?? "");
      expect((await calls(page)).filter((call) => call.command === write)).toEqual([]);
      await close(page);
      await open(page, "Ziel");
      await summary(page).press("Enter");
      expect(await input(page).inputValue()).toBe(existing);
      await input(page).fill(copied.at(-1)?.text ?? "");
      await save(page).press("Enter");
      await dialog(page).waitFor({ state: "hidden" });
      expect((await calls(page)).filter((call) => call.command === write)).toEqual([
        {
          command: write,
          connectionId: "target",
          knowledge: {
            ...initial.target,
            invariants: [],
            tables: { orders: { description, columns: initial.target.tables.orders.columns } },
          },
        },
      ]);
      expect((await calls(page)).map(({ command }) => command)).toEqual([
        read,
        clipboard,
        clipboard,
        read,
        read,
        read,
        write,
      ]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "scope switches suppress stale source and target data and block saving an unresolved draft",
  async () => {
    const { context, page, errors } = await fixture(1000);
    const switchScope = (id: string) =>
      page.evaluate(
        (detail) => window.dispatchEvent(new CustomEvent("fixture-knowledge-scope", { detail })),
        id,
      );
    try {
      await open(page, "Quelle");
      await summary(page).press("Enter");
      await copy(page).waitFor();
      await page.evaluate(() => {
        (window as Host).holdKnowledgeRead = "target";
      });
      await switchScope("target");
      await dialog(page).getByText("Wird geladen …", { exact: true }).waitFor();
      expect(await copy(page).count()).toBe(0);
      expect(await save(page).isDisabled()).toBe(true);
      await switchScope("empty");
      await dialog(page)
        .getByText(/^Noch keine Beschreibungen/)
        .waitFor();
      await page.evaluate(() => (window as Host).releaseKnowledgeRead?.());
      await page.waitForFunction(() => (window as Host).knowledgeReadReleased);
      expect(await summary(page).count()).toBe(0);
      expect(await copy(page).count()).toBe(0);
      await switchScope("error");
      await dialog(page).getByText("Das KI-Wissen konnte nicht geladen werden.").waitFor();
      expect(await save(page).isDisabled()).toBe(true);
      expect(await copy(page).count()).toBe(0);
      await switchScope("target");
      await summary(page).waitFor();
      await page.evaluate(() => {
        const host = window as Host;
        host.holdKnowledgeRead = "target";
        host.releaseKnowledgeRead = undefined;
        host.knowledgeReadReleased = false;
      });
      await save(page).press("Enter");
      await page.waitForFunction(() => Boolean((window as Host).releaseKnowledgeRead));
      await switchScope("empty");
      await dialog(page)
        .getByText(/^Noch keine Beschreibungen/)
        .waitFor();
      await page.evaluate(() => (window as Host).releaseKnowledgeRead?.());
      await page.waitForFunction(() => (window as Host).knowledgeReadReleased);
      await close(page);
      expect(await calls(page)).toEqual([
        { command: read, connectionId: "source" },
        { command: read, connectionId: "target" },
        { command: read, connectionId: "empty" },
        { command: read, connectionId: "error" },
        { command: read, connectionId: "target" },
        { command: read, connectionId: "target" },
        { command: read, connectionId: "empty" },
      ]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "expanded descriptions stay bounded at scale with no metadata reads while browsing or copying",
  async () => {
    const columns = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`col_${index}`, `Fachtext ${index}`]),
    );
    const tables = Object.fromEntries(
      Array.from({ length: 1200 }, (_, index) => [
        `table_${index}`,
        { description: `${index} ${"Aufträge und Gutschriften. ".repeat(50)}`, columns },
      ]),
    );
    const { context, page, errors } = await fixture(1000, {
      source: { notes: "", glossary: [], tables },
    });
    try {
      await open(page, "Quelle");
      const first = summary(page, "table_0");
      await first.waitFor();
      const fields = dialog(page).locator("details input,details textarea");
      const selector = '[role="dialog"] details[open] textarea';
      expect(await fields.count()).toBe(0);
      const samples: number[] = [];
      for (let index = 0; index < 8; index++) {
        const time = await measureAppClick(page, first, selector);
        if (index > 1) samples.push(time);
        expect(await fields.count()).toBe(9);
        await copy(page, "table_0").press("Enter");
        await first.press("Enter");
        await fields.first().waitFor({ state: "detached" });
        expect(await fields.count()).toBe(0);
      }
      const stats = interactionPercentiles(samples);
      if (!process.env.CI) expect(stats.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual([
        { command: read, connectionId: "source" },
        ...Array.from({ length: 8 }, () => ({
          command: clipboard,
          text: tables.table_0?.description,
        })),
      ]);
      expect(errors).toEqual([]);
      console.log("A26 browser", { tables: 1200, totalFields: 10_800, mountedFields: 9, ...stats });
    } finally {
      await context.close();
    }
  },
  45_000,
);
