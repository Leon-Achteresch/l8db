import { expect, test } from "bun:test";
import { chromium } from "playwright";

test.skipIf(!process.env.L8DB_QUERY_BROWSER_URL)(
  "query workspace: layouts, schema, execution, results and custom shortcuts",
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.testRuns = [];
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          if (cmd === "list_schemas") return ["public"];
          if (cmd === "list_tables")
            return [
              { schema: "public", name: "customers" },
              { schema: "public", name: "orders" },
            ];
          if (cmd === "list_all_columns")
            return ["customers", "orders"].flatMap((table) =>
              ["id", "email", "created_at"].map((name) => ({
                schema: "public",
                table,
                name,
                data_type: name === "id" ? "integer" : name === "email" ? "text" : "timestamp",
              })),
            );
          if (cmd === "execute_query") {
            window.testRuns.push(args.sql);
            await new Promise((r) => setTimeout(r, 150));
            if (args.sql.trim().startsWith("SELECT count"))
              return {
                columns: ["count"],
                rows: [{ count: "7" }],
                rows_affected: null,
                execution_time_ms: 2,
              };
            return {
              columns: ["id", "email", "created_at"],
              rows: [
                { id: "1", email: "mara@example.test", created_at: "2026-08-21" },
                { id: "2", email: "elio@example.test", created_at: "2026-08-24" },
              ],
              rows_affected: null,
              execution_time_ms: 12,
            };
          }
          return [];
        },
      };
    });
    try {
      await page.goto(`${process.env.L8DB_QUERY_BROWSER_URL}/tests/fixtures/query-workspace.html`);
      await page.getByRole("button", { name: "Anpassen", exact: true }).waitFor();
      await page.locator(".monaco-editor").first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-query-before.png" });
      await page.getByRole("button", { name: "Ausführen", exact: true }).click();
      await page.getByText("mara@example.test", { exact: true }).waitFor();
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      await page.getByRole("textbox", { name: "Ergebnisse durchsuchen" }).fill("elio");
      if (
        !(await page.locator("pre").innerText()).includes("elio") ||
        (await page.locator("pre").innerText()).includes("mara")
      )
        throw Error("Result search failed");
      await page.getByRole("button", { name: "Tabelle", exact: true }).click();
      await page.getByRole("textbox", { name: "Ergebnisse durchsuchen" }).fill("");
      await page.getByRole("button", { name: "Anpassen", exact: true }).click();
      await page.getByRole("button", { name: "Analysieren Ergebnisse rechts" }).click();
      await page.getByLabel("Zeilenhöhe der Ergebnisse").selectOption("40");
      await page.getByLabel("Spaltenbreite der Ergebnisse").selectOption("280");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const editorBox = await page.locator("#editor").boundingBox();
      const resultsBox = await page.locator("#results").boundingBox();
      expect(editorBox).not.toBeNull();
      expect(resultsBox).not.toBeNull();
      expect(resultsBox!.x).toBeGreaterThan(editorBox!.x);
      expect(editorBox!.width / (editorBox!.width + resultsBox!.width)).toBeCloseTo(0.4, 1);
      expect(
        (await page.locator('tbody tr[data-index="0"]').boundingBox())?.height,
      ).toBeGreaterThanOrEqual(40);
      await page.screenshot({ path: "/tmp/l8db-query-analysis.png" });
      await page.getByRole("button", { name: "Anpassen", exact: true }).click();
      await page.getByRole("button", { name: "Entwickeln Schema neben SQL" }).click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("textbox", { name: "Schema durchsuchen" }).fill("customers");
      await page.getByRole("button", { name: "Tabellennamen einfügen" }).click();
      await page.keyboard.press("ControlOrMeta+z");
      await page.keyboard.press("ControlOrMeta+Shift+y");
      await page.waitForTimeout(250);
      if ((await page.evaluate(() => window.testRuns.length)) !== 2)
        throw Error("Custom run shortcut did not execute exactly once");
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(250);
      if ((await page.evaluate(() => window.testRuns.length)) !== 2)
        throw Error("Old run shortcut still active");
      await page.getByRole("button", { name: "Skript", exact: true }).click();
      await page.getByRole("button", { name: "Skript ausführen", exact: true }).click();
      await page.getByText("2/2 erfolgreich", { exact: true }).waitFor();
      await page.getByRole("button").filter({ hasText: "SELECT id, email, created_at" }).click();
      await page.getByText("mara@example.test", { exact: true }).waitFor();
      await page.getByRole("button").filter({ hasText: "SELECT count(*)" }).click();
      await page.getByText("7", { exact: true }).last().waitFor();
      await page.getByRole("textbox", { name: "Schema durchsuchen" }).fill("");
      await page.screenshot({ path: "/tmp/l8db-query-develop.png" });
      await page.setViewportSize({ width: 900, height: 700 });
      await page.screenshot({ path: "/tmp/l8db-query-compact.png" });
      await page.reload();
      await page.getByRole("button", { name: "Anpassen", exact: true }).click();
      expect(await page.getByLabel("Zeilenhöhe der Ergebnisse").inputValue()).toBe("40");
      expect(await page.getByLabel("Spaltenbreite der Ergebnisse").inputValue()).toBe("280");
      await page.screenshot({ path: "/tmp/l8db-query-settings.png" });
      expect(errors).toEqual([]);
      console.log(
        "PASS: run, filtered JSON, presets, navigator insertion, undo, remapped shortcuts, compact viewport.",
      );
    } finally {
      await browser.close();
    }
  },
  60_000,
);
