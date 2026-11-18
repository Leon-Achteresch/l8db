import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const legacy = "/fixtures/legacy.sql";
const invalid = "/fixtures/invalid.sql";
const utf8 = "/fixtures/plain.sql";
const windows = "/fixtures/win1252.sql";
const copy = "/fixtures/new-utf8.sql";
const source = "SELECT 'Grüße € 東京 🧪';";
const latest = "SELECT 'neuer Stand';";
const encoded = (sql: string) => [...Buffer.from(`\uFEFF${sql}`, "utf16le")];

type Host = {
  open: string | null;
  save: string | null;
  files: Record<string, { bytes: number[]; mtime: number }>;
  calls: string[];
  writes: { path: string; createNew: boolean; text: string }[];
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width = 380, colorScheme: "light" | "dark" = "dark") {
  const context = await browser.newContext({ colorScheme, viewport: { width, height: 525 } });
  const initial: Host = {
    open: null,
    save: null,
    calls: [],
    writes: [],
    files: {
      [legacy]: { bytes: encoded(source), mtime: 100 },
      [invalid]: { bytes: [255, 254, 0], mtime: 100 },
      [utf8]: { bytes: [...Buffer.from("SELECT 'Zürich';")], mtime: 100 },
      [windows]: { bytes: [0x5a, 0xe4, 0x68, 0x6c, 0x80], mtime: 100 },
    },
  };
  await context.addInitScript((state) => {
    Object.assign(window, {
      sqlFileHost: state,
      __TAURI_INTERNALS__: {
        invoke: async (
          name: string,
          args: { path?: string } | Uint8Array,
          options?: { headers: Record<string, string> },
        ) => {
          state.calls.push(name);
          if (name === "plugin:dialog|open") return state.open;
          if (name === "plugin:dialog|save") return state.save;
          if (name === "plugin:fs|write_text_file" && args instanceof Uint8Array) {
            const path = decodeURIComponent(options?.headers.path ?? "");
            const createNew = Boolean(JSON.parse(options?.headers.options ?? "{}").createNew);
            if (createNew && state.files[path]) throw Error("File already exists");
            const text = new TextDecoder().decode(args);
            state.writes.push({ path, createNew, text });
            state.files[path] = { bytes: [...args], mtime: 200 };
            return;
          }
          const path = (args as { path?: string })?.path;
          const file = path ? state.files[path] : undefined;
          if (name === "plugin:fs|stat")
            return { size: file?.bytes.length ?? 0, mtime: file?.mtime ?? null };
          if (name === "plugin:fs|read_file" && file) return file.bytes;
          throw Error(`Unexpected fixture IPC: ${name}`);
        },
      },
    });
  }, initial);
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  await page.goto(`${url}/tests/fixtures/sql-file-encoding.html`, { timeout: 35_000 });
  await page.getByRole("button", { name: "Weitere Werkzeuge" }).waitFor();
  await page.locator(`html.${colorScheme}`).waitFor();
  return { context, page };
}

const host = (page: Page) =>
  page.evaluate(() => (window as unknown as { sqlFileHost: Host }).sqlFileHost);
const pick = (page: Page, field: "open" | "save", path: string | null) =>
  page.evaluate(
    ([field, path]) => {
      (window as unknown as { sqlFileHost: Host }).sqlFileHost[field] = path;
    },
    [field, path] as const,
  );
const editor = (page: Page) => page.getByRole("textbox", { name: "SQL", exact: true });
const dialog = (page: Page) => page.getByRole("alertdialog");
async function expectSql(page: Page, text: string) {
  await page.waitForFunction(
    (wanted) => document.querySelector("textarea")?.value === wanted,
    text,
  );
}

async function fileAction(page: Page, name: string) {
  const trigger = page.getByRole("button", { name: "Weitere Werkzeuge" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Datei", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const action = page.getByRole("menuitem", { name, exact: true });
  await action.focus();
  await page.keyboard.press("Enter");
}

async function readUtf16(page: Page, action: "open" | "reload", dirty = false) {
  await fileAction(
    page,
    action === "open" ? "SQL-Datei mit Kodierung öffnen…" : "Datei mit Kodierung neu laden…",
  );
  await dialog(page).getByRole("radio", { name: "UTF-16 LE", exact: true }).click();
  await dialog(page)
    .getByRole("button", {
      name: dirty ? "Verwerfen und neu laden" : action === "open" ? "Datei auswählen" : "Neu laden",
      exact: true,
    })
    .click();
}

run(
  "normal file opening keeps UTF-8 and Windows-1252 and the picker can be canceled",
  async () => {
    const { page, context } = await fixture(900, "light");
    try {
      await pick(page, "open", utf8);
      await fileAction(page, "SQL-Datei öffnen…");
      await expectSql(page, "SELECT 'Zürich';");
      await pick(page, "open", windows);
      await fileAction(page, "SQL-Datei öffnen…");
      await expectSql(page, "Zähl€");
      const reads = (await host(page)).calls.filter(
        (name) => name === "plugin:fs|read_file",
      ).length;
      await pick(page, "open", null);
      await fileAction(page, "SQL-Datei öffnen…");
      await expectSql(page, "Zähl€");
      const calls = (await host(page)).calls;
      expect(calls.filter((name) => name === "plugin:fs|read_file")).toHaveLength(reads);
      expect(calls.at(-1)).toBe("plugin:dialog|open");
      expect((await host(page)).writes).toEqual([]);
    } finally {
      await context.close();
    }
  },
  60_000,
);

run(
  "UTF-16 must be chosen, invalid reload preserves the draft and save creates a new UTF-8 file",
  async () => {
    const { page, context } = await fixture();
    try {
      await pick(page, "open", legacy);
      await fileAction(page, "SQL-Datei mit Kodierung öffnen…");
      await dialog(page).waitFor();
      const auto = dialog(page).getByRole("radio", { name: /^Automatisch/ });
      expect(await auto.getAttribute("aria-checked")).toBe("true");
      await dialog(page)
        .getByRole("button", { name: "Abbrechen" })
        .and(page.locator(":focus"))
        .waitFor();
      await auto.focus();
      await page.keyboard.down("ArrowDown");
      const le = dialog(page).getByRole("radio", { name: "UTF-16 LE", exact: true });
      await le.and(page.locator(":focus")).waitFor();
      await page.keyboard.up("ArrowDown");
      await page.keyboard.press("Space");
      await le.and(page.locator('[aria-checked="true"]')).waitFor();
      await dialog(page).screenshot({
        path: "test-artifacts/a24/encoding-narrow.png",
        animations: "disabled",
      });
      const box = await dialog(page).boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(380);
      await dialog(page).getByRole("button", { name: "Datei auswählen", exact: true }).click();
      await expectSql(page, source);
      await editor(page).fill("lokaler Entwurf");
      await fileAction(page, "Datei mit Kodierung neu laden…");
      await dialog(page).getByRole("button", { name: "Verwerfen und neu laden" }).waitFor();
      const before = (await host(page)).calls.length;
      await dialog(page).getByRole("button", { name: "Abbrechen", exact: true }).click();
      await dialog(page).waitFor({ state: "hidden" });
      await expectSql(page, "lokaler Entwurf");
      expect((await host(page)).calls).toHaveLength(before);

      await page.evaluate(
        ([legacy, invalid]) => {
          const { files } = (window as unknown as { sqlFileHost: Host }).sqlFileHost;
          files[legacy] = { ...files[invalid], mtime: 101 };
        },
        [legacy, invalid] as const,
      );
      await readUtf16(page, "reload", true);
      await page.getByText(/Datei konnte nicht neu geladen werden: Ungültige Dateibytes/).waitFor();
      await expectSql(page, "lokaler Entwurf");
      await page.evaluate(
        ([path, bytes]) => {
          (window as unknown as { sqlFileHost: Host }).sqlFileHost.files[path] = {
            bytes,
            mtime: 102,
          };
          window.dispatchEvent(new Event("focus"));
        },
        [legacy, encoded(latest)] as const,
      );
      await page
        .getByRole("button", { name: "Neu laden (lokale Änderungen verwerfen)", exact: true })
        .click();
      await expectSql(page, latest);

      await editor(page).fill(source);
      await pick(page, "save", legacy);
      await fileAction(page, "UTF-8-Kopie speichern…");
      await page
        .getByText("Wähle einen neuen Dateinamen für die UTF-8-Kopie.", { exact: true })
        .waitFor();
      expect((await host(page)).writes).toEqual([]);
      await pick(page, "save", copy);
      await fileAction(page, "UTF-8-Kopie speichern…");
      await page.getByLabel("Dateibindung").getByText(copy, { exact: true }).waitFor();
      const final = await host(page);
      expect(final.writes).toEqual([{ path: copy, createNew: true, text: source }]);
      expect(final.files[legacy].bytes).toEqual(encoded(latest));
      expect(
        final.calls.every(
          (name) => name.startsWith("plugin:dialog|") || name.startsWith("plugin:fs|"),
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  },
  65_000,
);
