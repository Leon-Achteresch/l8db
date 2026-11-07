import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium, type Page, webkit } from "playwright";
import { createServer } from "vite";

async function setSql(page: Page, sql: string) {
  await page.evaluate(
    (text) =>
      (
        window as unknown as { workbenchFixture: { setSql: (sql: string) => void } }
      ).workbenchFixture.setSql(text),
    sql,
  );
  await page.waitForFunction(
    (text) =>
      document
        .querySelector(".monaco-editor .view-lines")
        ?.textContent?.replaceAll("\u00a0", " ")
        .includes(text),
    sql,
  );
}

test.skipIf(!process.env.L8DB_WORKBENCH_BROWSER)(
  "all six workbench helpers: persistence, success/failure, variants, parameters, investigations and watched rows",
  async () => {
    const server = await createServer({
      configFile: false,
      cacheDir: "node_modules/.vite-workbench-qol",
      optimizeDeps: { entries: ["tests/fixtures/workbench-qol.html"] },
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": resolve("src") } },
      server: { port: 0, hmr: false },
    });
    await server.listen();
    const browser = await (process.env.L8DB_WORKBENCH_BROWSER === "webkit"
      ? webkit
      : chromium
    ).launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls: string[] = [];
    await context.exposeFunction("workbenchInvoke", (command: string, args: { sql?: string }) => {
      calls.push(command);
      if (command === "list_schemas") return ["public"];
      if (command === "list_tables") return [{ schema: "public", name: "customers" }];
      if (command === "list_all_columns")
        return [{ schema: "public", table: "customers", name: "id", data_type: "integer" }];
      if (command === "execute_query" || command === "execute_query_with_params") {
        if (args.sql?.includes("broken")) throw new Error("ERROR: column broken does not exist");
        return { columns: ["id"], rows: [{ id: "1" }], rows_affected: 1, execution_time_ms: 1 };
      }
      return [];
    });
    await context.addInitScript(() => {
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: unknown) =>
            (
              window as unknown as {
                workbenchInvoke: (command: string, args: unknown) => Promise<unknown>;
              }
            ).workbenchInvoke(command, args),
          transformCallback: () => 1,
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        },
      });
    });
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Fixture server fehlt.");
    const url = `http://localhost:${address.port}/tests/fixtures/workbench-qol.html`;
    try {
      await page.goto(url, { waitUntil: "commit" });
      await page
        .getByRole("button", { name: "SQL-Stände", exact: true })
        .waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByText("1 Zeile", { exact: false }).first().waitFor();
      await setSql(page, "SELECT broken FROM public.customers");
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByText("Spalte broken existiert nicht.", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "SQL-Stände", exact: true }).click();
      await page.getByRole("button", { name: /Letzten Erfolg vergleichen/ }).click();
      await page.getByRole("button", { name: "Im Editor wiederherstellen" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".monaco-editor .view-lines")
            ?.textContent?.includes("customers") &&
          !document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("broken"),
      );
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.press("ControlOrMeta+Z");
      await page.waitForFunction(() =>
        document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("broken"),
      );
      await page.keyboard.press("ControlOrMeta+Shift+Z");
      await page.waitForFunction(
        () =>
          !document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("broken"),
      );
      await page.getByRole("button", { name: "SQL-Stände", exact: true }).click();
      await page.getByRole("textbox", { name: "Name des SQL-Stands" }).fill("Vor Join");
      await page.getByRole("button", { name: "Stand speichern", exact: true }).click();
      await page.getByText("Vor Join", { exact: true }).waitFor();
      await mkdir("test-artifacts/workbench-qol", { recursive: true });
      await page.setViewportSize({ width: 390, height: 940 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-sql-dialog-390.png`,
      });
      await page.setViewportSize({ width: 1440, height: 940 });
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-sql-dialog-1440.png`,
      });
      await page.keyboard.press("Escape");
      await page.reload({ waitUntil: "commit" });
      await page.getByRole("button", { name: "SQL-Stände", exact: true }).click();
      await page.getByText("Vor Join", { exact: true }).waitFor();
      const second = await context.newPage();
      await second.goto(url, { waitUntil: "commit" });
      await second.getByRole("button", { name: "SQL-Stände", exact: true }).click();
      await second.getByRole("textbox", { name: "Name des SQL-Stands" }).fill("Anderes Fenster");
      await second.getByRole("button", { name: "Stand speichern", exact: true }).click();
      await page.getByText("Anderes Fenster", { exact: true }).waitFor();
      await second.close();
      await page
        .getByRole("button", { name: "SQL-Stand Anderes Fenster löschen", exact: true })
        .click();
      await page.getByText("Anderes Fenster", { exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: /Variante öffnen/ }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const tabs = await page.evaluate(() =>
        (
          window as unknown as { workbenchFixture: { getTabs: () => { variant?: unknown }[] } }
        ).workbenchFixture.getTabs(),
      );
      expect(tabs.some((tab) => Boolean(tab.variant))).toBe(true);
      await setSql(page, "SELECT :customer");
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByRole("dialog", { name: "Bind-Parameter", exact: true }).waitFor();
      await page.getByLabel(":customer", { exact: true }).fill("4711");
      await page.getByRole("textbox", { name: "Name des Parametersatzes" }).fill("Kunde A");
      await page.getByRole("button", { name: /Werte merken/ }).click();
      await page.getByRole("button", { name: "Kunde A", exact: true }).waitFor();
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-parameters.png`,
      });
      await page.getByLabel(":customer", { exact: true }).fill("andere Werte");
      await page.getByRole("button", { name: "Kunde A", exact: true }).click();
      expect(await page.getByLabel(":customer", { exact: true }).inputValue()).toBe("4711");
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page.reload({ waitUntil: "commit" });
      await page.getByRole("button", { name: "SQL-Stände", exact: true }).waitFor();
      await setSql(page, "SELECT :customer");
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByRole("button", { name: "Kunde A", exact: true }).click();
      expect(await page.getByLabel(":customer", { exact: true }).inputValue()).toBe("4711");
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page.getByRole("button", { name: "Arbeitsstände", exact: true }).click();
      await page.getByRole("textbox", { name: "Name des Arbeitsstands" }).fill("Bestellung 4711");
      await page
        .getByRole("textbox", { name: "Notiz zum Arbeitsstand" })
        .fill("Doppelten Import prüfen");
      await page.getByRole("button", { name: "Aktuelle Tabs speichern", exact: true }).click();
      await page.getByText("Bestellung 4711", { exact: true }).waitFor();
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-investigation.png`,
      });
      const beforeRestore = calls.filter((command) => command.startsWith("execute_")).length;
      await page.getByRole("button", { name: "Öffnen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(calls.filter((command) => command.startsWith("execute_")).length).toBe(beforeRestore);
      await page.getByRole("button", { name: "Tabelle umschalten", exact: true }).click();
      await page.locator('tr[data-ctid="0"]').waitFor();
      await page.locator('tr[data-ctid="0"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "Datensatz beobachten", exact: true }).click();
      await page.getByRole("button", { name: "Weitere Aktionen", exact: true }).click();
      await page.getByRole("menuitem", { name: /Beobachtete Zeilen \(1\)/ }).waitFor();
      await page.keyboard.press("Escape");
      const beforeWatch = calls.length;
      await page.getByRole("button", { name: "Neu laden", exact: true }).click();
      await page.getByRole("button", { name: "Weitere Aktionen", exact: true }).click();
      await page.getByRole("menuitem", { name: /1 geändert/ }).click();
      await page
        .getByRole("dialog", { name: "Beobachtete Zeilen" })
        .getByText('"geändert"', { exact: true })
        .waitFor();
      expect(calls.length).toBe(beforeWatch);
      expect(await page.locator("tbody tr").count()).toBeLessThan(90);
      await mkdir("test-artifacts/workbench-qol", { recursive: true });
      for (const width of [1440, 760, 390]) {
        await page.setViewportSize({ width, height: 940 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await page.screenshot({
          path: `test-artifacts/workbench-qol/${browser.browserType().name()}-${width}.png`,
        });
      }
      await page.setViewportSize({ width: 1440, height: 940 });
      await page.getByRole("button", { name: "Design wechseln", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 940 });
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-light-390.png`,
      });
      await page.setViewportSize({ width: 1440, height: 940 });
      await page.screenshot({
        path: `test-artifacts/workbench-qol/${browser.browserType().name()}-light-1440.png`,
      });
      await page.getByRole("button", { name: "Stand übernehmen", exact: true }).click();
      await page.getByText("Geladene Werte unverändert", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Beobachtung id=0 entfernen", exact: true }).click();
      await page.getByText("Wichtige Zeilen im Blick behalten", { exact: true }).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await mkdir("test-artifacts/workbench-qol", { recursive: true });
      await page
        .screenshot({ path: "test-artifacts/workbench-qol/last-state.png" })
        .catch(() => {});
      await browser.close();
      await server.close();
    }
  },
  120000,
);
