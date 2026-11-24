import { expect, test } from "bun:test";
import { type Browser, type BrowserType, chromium, type Page, webkit } from "playwright";

const url = process.env.L8DB_FILTER_BROWSER_URL;
const shots = process.env.L8DB_FILTER_SCREENSHOTS;

async function open(browser: Browser, query: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1180, height: 640 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await page.addInitScript(() => {
    const state = window as unknown as Record<string, unknown> & { __invokes: string[] };
    state.__invokes = [];
    let next = 1;
    state.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        const id = next++;
        state[`_${id}`] = callback;
        return id;
      },
      invoke: async (cmd: string) => {
        state.__invokes.push(cmd);
        if (cmd === "count_table_rows_capped") return { count: 4, exact: true, estimate: null };
        return [];
      },
    };
  });
  await page.goto(`${url}/tests/fixtures/filter-bar.html?${query}`);
  return { page, errors };
}

const sorting = async (page: Page) =>
  JSON.parse((await page.getByLabel("Applied sorting").textContent()) ?? "null");
const applied = (page: Page) => page.getByLabel("Applied filter").textContent();
const applyCount = (page: Page) => page.getByLabel("Apply count").textContent();
const addSort = (page: Page) => page.getByRole("button", { name: "Sortierung hinzufügen" });
const sortToken = (page: Page) => page.locator('[data-filter-token="sort"]');
const header = (page: Page, name: string) =>
  page.getByRole("columnheader").getByRole("button", { name, exact: true });
const chip = (page: Page, name: string) =>
  page.locator("button[aria-pressed]").filter({ hasText: name });
const pressed = (page: Page, name: string) => chip(page, name).getAttribute("aria-pressed");

async function pickColumn(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Sortierspalte" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function expectSorting(page: Page, expected: unknown) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (JSON.stringify(await sorting(page)) === JSON.stringify(expected)) return;
    await page.waitForTimeout(50);
  }
  expect(await sorting(page)).toEqual(expected);
}

async function saveView(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Filter, Sortierung und Spalten als Ansicht speichern" })
    .click();
  await page.getByPlaceholder("View-Name").fill(name);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await chip(page, name).waitFor();
}

async function shot(page: Page, name: string, engine: string) {
  if (shots && engine === "chromium") await page.screenshot({ path: `${shots}/${name}.png` });
}

for (const engine of [chromium, webkit] as BrowserType[]) {
  for (const style of ["classic", "omnibar", "pills"]) {
    test.skipIf(!url)(
      `${engine.name()}: ${style} bar hides sorting while the setting is off`,
      async () => {
        const browser = await engine.launch({ headless: true });
        try {
          const { page, errors } = await open(browser, `style=${style}`);
          await header(page, "tokens").waitFor();
          expect(await addSort(page).count()).toBe(0);
          await header(page, "status").click();
          await expectSorting(page, [{ id: "status", desc: false }]);
          expect(await sortToken(page).count()).toBe(0);
          expect(await addSort(page).count()).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await browser.close();
        }
      },
      60_000,
    );

    test.skipIf(!url)(
      `${engine.name()}: ${style} bar sets, flips, changes and removes the sorting`,
      async () => {
        const browser = await engine.launch({ headless: true });
        try {
          const { page, errors } = await open(browser, `style=${style}&sorting`);
          await addSort(page).waitFor();
          expect(await sortToken(page).count()).toBe(0);

          await addSort(page).click();
          const direction = page.getByRole("radiogroup", { name: "Sortierrichtung" });
          await direction.waitFor();
          expect(await direction.getByRole("radio", { name: "Aufsteigend" }).isChecked()).toBe(
            true,
          );
          await direction.getByText("Absteigend").click();
          expect(await sorting(page)).toEqual([]);
          await pickColumn(page, "tokens");
          await expectSorting(page, [{ id: "tokens", desc: true }]);
          await sortToken(page).waitFor();
          expect(await addSort(page).count()).toBe(0);
          await shot(page, `sort-${style}-open`, engine.name());

          await direction.getByText("Aufsteigend").click();
          await expectSorting(page, [{ id: "tokens", desc: false }]);
          await pickColumn(page, "status");
          await expectSorting(page, [{ id: "status", desc: false }]);
          await page.keyboard.press("Escape");
          await direction.waitFor({ state: "detached" });
          await shot(page, `sort-${style}`, engine.name());

          await page
            .getByRole("button", { name: "Aufsteigend nach status – absteigend sortieren" })
            .click();
          await expectSorting(page, [{ id: "status", desc: true }]);
          await page
            .getByRole("button", { name: "Absteigend nach status – aufsteigend sortieren" })
            .click();
          await expectSorting(page, [{ id: "status", desc: false }]);

          await header(page, "message_id").click();
          await expectSorting(page, [{ id: "message_id", desc: false }]);
          await page.getByRole("button", { name: "Sortierung ändern: message_id" }).waitFor();
          await header(page, "message_id").click();
          await page
            .getByRole("button", { name: "Absteigend nach message_id – aufsteigend sortieren" })
            .waitFor();

          await page.getByRole("button", { name: "Sortierung ändern: message_id" }).click();
          await direction.waitFor();
          expect(await direction.getByRole("radio", { name: "Absteigend" }).isChecked()).toBe(true);
          await page.getByRole("button", { name: "Sortierung ändern: message_id" }).click();
          await direction.waitFor({ state: "detached" });

          await page.getByRole("button", { name: "Sortierung entfernen: message_id" }).click();
          await expectSorting(page, []);
          await addSort(page).waitFor();
          expect(await sortToken(page).count()).toBe(0);

          expect(await applied(page)).toBe("");
          expect(await applyCount(page)).toBe("0");
          expect(errors).toEqual([]);
        } finally {
          await browser.close();
        }
      },
      60_000,
    );
  }

  test.skipIf(!url)(
    `${engine.name()}: the settings switch shows and hides the sorting live`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const { page, errors } = await open(browser, "style=pills&settings");
        const toggle = page.getByRole("switch", { name: "Sortierung in der Filterleiste" });
        await toggle.waitFor();
        expect(await toggle.isChecked()).toBe(false);
        expect(await addSort(page).count()).toBe(0);
        await toggle.click();
        await addSort(page).waitFor();
        await shot(page, "sort-settings", engine.name());
        await addSort(page).click();
        await pickColumn(page, "id");
        await page.keyboard.press("Escape");
        await sortToken(page).waitFor();
        await toggle.click();
        await sortToken(page).waitFor({ state: "detached" });
        await expectSorting(page, [{ id: "id", desc: false }]);
        await toggle.click();
        await sortToken(page).waitFor();
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  test.skipIf(!url)(
    `${engine.name()}: only sortable columns are offered`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const { page, errors } = await open(browser, "style=pills&sorting&sortable=id,tokens");
        await addSort(page).click();
        await page.getByRole("combobox", { name: "Sortierspalte" }).click();
        await page.getByRole("option", { name: "tokens", exact: true }).waitFor();
        expect(await page.getByRole("option").allTextContents()).toEqual(["id", "tokens"]);
        await page.getByRole("option", { name: "tokens", exact: true }).click();
        await expectSorting(page, [{ id: "tokens", desc: false }]);
        expect(errors).toEqual([]);

        const none = await open(browser, "style=pills&sorting&sortable=");
        await header(none.page, "tokens").waitFor();
        expect(await addSort(none.page).count()).toBe(0);
        expect(none.errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  test.skipIf(!url)(
    `${engine.name()}: saved views keep filter and sorting together and survive a reload`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const { page, errors } = await open(browser, "style=pills&sorting&views");
        await chip(page, "Alle Zeilen").waitFor();
        expect(await pressed(page, "Alle Zeilen")).toBe("true");

        await addSort(page).click();
        await page
          .getByRole("radiogroup", { name: "Sortierrichtung" })
          .getByText("Absteigend")
          .click();
        await pickColumn(page, "tokens");
        await page.keyboard.press("Escape");
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        await page
          .getByRole("button", { name: "Filter, Sortierung und Spalten als Ansicht speichern" })
          .click();
        await page.getByText("↓ tokens", { exact: true }).waitFor();
        await shot(page, "sort-view-save", engine.name());
        await page.getByPlaceholder("View-Name").fill("Teuer");
        await page.getByRole("button", { name: "Speichern", exact: true }).click();
        await chip(page, "Teuer").waitFor();
        expect(await pressed(page, "Teuer")).toBe("true");
        expect(await pressed(page, "Alle Zeilen")).toBe("false");
        expect(await chip(page, "Teuer").getAttribute("title")).toBe("↓ tokens");

        await header(page, "status").click();
        await expectSorting(page, [{ id: "status", desc: false }]);
        expect(await pressed(page, "Teuer")).toBe("false");
        expect(await pressed(page, "Alle Zeilen")).toBe("true");

        await chip(page, "Teuer").click();
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        expect(await pressed(page, "Teuer")).toBe("true");

        await chip(page, "Alle Zeilen").click();
        await expectSorting(page, []);
        expect(await pressed(page, "Alle Zeilen")).toBe("true");
        expect(await pressed(page, "Teuer")).toBe("false");

        await page.getByRole("button", { name: "Filter hinzufügen" }).click();
        await page.getByRole("combobox", { name: "Spalte" }).click();
        await page.getByRole("option", { name: "status", exact: true }).click();
        await page.getByRole("textbox", { name: "Wert" }).fill("error");
        await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
        expect(await applied(page)).toBe(`"status" = 'error'`);
        await saveView(page, "Unsortiert");
        await addSort(page).click();
        await pickColumn(page, "id");
        await page.keyboard.press("Escape");
        await expectSorting(page, [{ id: "id", desc: false }]);
        await saveView(page, "Fehler");
        expect(await chip(page, "Fehler").getAttribute("title")).toBe(`"status" = 'error' · ↑ id`);
        await shot(page, "sort-views", engine.name());

        await chip(page, "Teuer").click();
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        expect(await applied(page)).toBe("");
        expect(await page.getByRole("button", { name: /^Filter entfernen:/ }).count()).toBe(0);

        await chip(page, "Fehler").click();
        await expectSorting(page, [{ id: "id", desc: false }]);
        expect(await applied(page)).toBe(`"status" = 'error'`);
        await page.getByRole("button", { name: "Filter entfernen: status = error" }).waitFor();

        await chip(page, "Teuer").click();
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        await chip(page, "Unsortiert").click();
        await expectSorting(page, []);
        expect(await applied(page)).toBe(`"status" = 'error'`);
        await addSort(page).waitFor();

        await chip(page, "Teuer").click();
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        await page.waitForTimeout(1_500);
        await page.reload();
        await chip(page, "Teuer").waitFor();
        await expectSorting(page, [{ id: "tokens", desc: true }]);
        await page
          .getByRole("button", { name: "Absteigend nach tokens – aufsteigend sortieren" })
          .waitFor();
        expect(await pressed(page, "Teuer")).toBe("true");
        await chip(page, "Fehler").click();
        await expectSorting(page, [{ id: "id", desc: false }]);
        expect(await applied(page)).toBe(`"status" = 'error'`);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
}
