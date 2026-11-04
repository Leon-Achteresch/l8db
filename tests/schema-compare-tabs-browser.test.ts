import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { seedApp } from "./fixtures/perf-app";

async function pickTarget(page: Page, schema: string) {
  await page.getByRole("button", { name: /^Ziel:/ }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("combobox", { name: "Ziel: Verbindung" }).click();
  await page.getByRole("option", { name: "perf", exact: true }).click();
  await picker.getByRole("combobox", { name: "Ziel: Schema" }).click();
  await page.getByRole("option", { name: schema, exact: true }).click();
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
}

const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.skipIf(!process.env.L8DB_SCHEMA_COMPARE_BROWSER)(
  "mehrere Schema-Vergleiche als Tabs überstehen Neuladen und Verbindungswechsel",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = resolve(root, `.${new URL(request.url).pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        return new Response(
          path !== root && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
        );
      },
    });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 2, { rows: 2, columns: 2 }, "pw", 2);
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
        stored.state.connections.push({
          ...stored.state.connections[0],
          id: "perf2",
          name: "perf2",
        });
        localStorage.setItem("l8db.connections", JSON.stringify(stored));
        const host = window as unknown as {
          catalogCalls: number;
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        };
        host.catalogCalls = 0;
        const invoke = host.__TAURI_INTERNALS__.invoke;
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command !== "schema_catalog") return invoke(command, args);
          host.catalogCalls++;
          const schema = String(args?.schema);
          return [
            {
              object_type: "table",
              name: `nur_${schema}`,
              parent: null,
              ddl: `CREATE TABLE "${schema}"."nur_${schema}" ()`,
              attributes: {},
            },
          ];
        };
      });
      await page.goto(`http://localhost:${server.port}/schema-compare`);
      await page.getByRole("button", { name: /^Quelle: perf/ }).waitFor();
      await pickTarget(page, "schema_0");
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_0" }).waitFor();
      await tab(page, "public → schema_0").waitFor();

      await page.getByRole("link", { name: "Schema-Vergleich" }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('[role="treeitem"]').length === 0);
      await pickTarget(page, "schema_1");
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_1" }).waitFor();
      await tab(page, "public → schema_1").waitFor();
      expect(await tab(page, "public → schema_0").count()).toBe(1);

      await tab(page, "public → schema_0").click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_0" }).waitFor();
      expect(await page.getByRole("treeitem").filter({ hasText: "nur_schema_1" }).count()).toBe(0);

      await page.waitForFunction(() =>
        localStorage.getItem("l8db.table-tabs")?.includes("public → schema_1"),
      );
      await page.reload();
      await tab(page, "public → schema_1").click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_1" }).waitFor();
      await tab(page, "public → schema_0").click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_0" }).waitFor();
      expect(
        await page.evaluate(() => (window as unknown as { catalogCalls: number }).catalogCalls),
      ).toBe(0);

      await page.locator("[data-sidebar] button", { hasText: "perf" }).first().click();
      await page.getByRole("option", { name: /perf2/ }).first().click();
      await page.getByLabel("Passwort", { exact: true }).fill("pw");
      await page.getByRole("button", { name: "Verbinden", exact: true }).last().click();
      await tab(page, "public → schema_0").click();
      await page.getByRole("treeitem").filter({ hasText: "nur_schema_0" }).waitFor();
      await tab(page, "public → schema_1").waitFor();
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.connections") ?? "{}").state.activeId,
        ),
      ).toBe("perf2");
      await page.screenshot({ path: "test-artifacts/browser/schema-compare-tabs-final.png" });
      expect(errors).toEqual([]);
    } catch (error) {
      await page
        .screenshot({ path: "test-artifacts/browser/schema-compare-tabs.png" })
        .catch(() => undefined);
      console.log(String(error).slice(0, 600));
      throw error;
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
