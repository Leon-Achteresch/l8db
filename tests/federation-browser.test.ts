import { expect, test } from "bun:test";
import { chromium, type Page, webkit } from "playwright";

const appUrl = process.env.L8DB_FEDERATION_BROWSER_URL;

type FixtureWindow = Window & {
  __federationCalls: { command: string; args: Record<string, unknown> }[];
  __federationSlow: boolean;
  __federationUnmount: () => void;
  __TAURI_INTERNALS__: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

async function chooseSource(
  page: Page,
  index: number,
  connection: string,
  alias: string,
  table: string,
) {
  await page.getByRole("textbox", { name: `Quelle ${index}: Alias` }).fill(alias);
  await page.getByRole("combobox", { name: `Quelle ${index}: Verbindung` }).fill(connection);
  await page.getByRole("option", { name: connection, exact: true }).click();
  await page.getByRole("combobox", { name: `Quelle ${index}: Schema` }).fill("public");
  await page.getByRole("combobox", { name: `Quelle ${index}: Schema` }).press("Escape");
  await page.getByRole("combobox", { name: `Quelle ${index}: Tabelle` }).fill(table);
  await page.getByRole("combobox", { name: `Quelle ${index}: Tabelle` }).press("Escape");
}

test.skipIf(!appUrl)(
  "federation: sources, JOIN execution, bounded grid, cancellation and idle behavior",
  async () => {
    const browser = await (process.env.L8DB_FEDERATION_BROWSER_ENGINE === "webkit"
      ? webkit
      : chromium
    ).launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = window as unknown as FixtureWindow;
      state.__federationCalls = [];
      state.__federationSlow = false;
      let rejectQuery: ((reason: Error) => void) | undefined;
      state.__TAURI_INTERNALS__ = {
        invoke: async (command, args = {}) => {
          state.__federationCalls.push({ command, args });
          if (command === "federation_catalog")
            return {
              databases: ["crm", "sales"],
              schemas: ["public"],
              tables: args.schema
                ? Array.from({ length: 5_000 }, (_, index) => ({
                    schema: "public",
                    name: index === 0 ? "customers" : index === 1 ? "orders" : `table_${index}`,
                  }))
                : [],
              hasMore: false,
            };
          if (command === "federation_query") {
            if (state.__federationSlow)
              return new Promise((_, reject) => {
                rejectQuery = reject;
              });
            return {
              result: {
                columns: ["id", "name", "amount"],
                rows: Array.from({ length: 10_000 }, (_, id) => ({
                  id,
                  name: `Customer ${id}`,
                  amount: 42,
                })),
                rows_affected: null,
                execution_time_ms: 15,
                truncated: true,
              },
              sources: [
                {
                  alias: "crm",
                  table: "customers",
                  rows: 20_000,
                  bytes: 1_000_000,
                  maskedColumns: [],
                },
              ],
              sourceRows: 40_000,
              sourceBytes: 2_000_000,
              sourceReads: 82,
              durationMs: 120,
            };
          }
          if (command === "cancel_execution") {
            rejectQuery?.(new Error("Abfrage wurde abgebrochen."));
            return true;
          }
          if (command === "mcp_config")
            return { connections: [], redaction: { columns: [], values: [], replacement: "***" } };
          return null;
        },
      };
    });
    try {
      await page.goto(`${appUrl}/tests/federation-fixture.html`);
      await page.getByRole("heading", { name: "Datenbankübergreifend abfragen" }).waitFor();
      expect(await page.getByRole("button", { name: "Abfrage ausführen" }).isDisabled()).toBe(true);
      await chooseSource(page, 1, "CRM", "crm", "customers");
      await page.getByRole("button", { name: "Quelle hinzufügen" }).click();
      await chooseSource(page, 2, "Sales", "sales", "orders");
      await page
        .locator(".cm-content")
        .fill(
          "SELECT c.id, c.name, o.amount FROM crm.customers c JOIN sales.orders o ON c.id=o.customer_id",
        );
      const started = performance.now();
      await page.getByRole("button", { name: "Abfrage ausführen" }).click();
      await page.getByText(/40.000 Quellzeilen/).waitFor();
      const duration = performance.now() - started;
      expect(duration).toBeLessThan(3_000);
      expect(await page.locator("tr[data-index]").count()).toBeLessThan(200);
      expect(await page.getByRole("button", { name: "Quelle hinzufügen" }).isEnabled()).toBe(true);
      const queries = await page.evaluate(() =>
        (window as unknown as FixtureWindow).__federationCalls.filter(
          (call) => call.command === "federation_query",
        ),
      );
      expect(queries).toHaveLength(1);
      expect(JSON.stringify(queries[0].args)).not.toContain("connectionString");
      await page.waitForTimeout(350);
      const beforeIdle = await page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__federationCalls.filter((call) =>
            call.command.startsWith("federation_"),
          ).length,
      );
      await page.waitForTimeout(600);
      const afterIdle = await page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__federationCalls.filter((call) =>
            call.command.startsWith("federation_"),
          ).length,
      );
      expect(afterIdle).toBe(beforeIdle);
      await page.evaluate(() => {
        (window as unknown as FixtureWindow).__federationSlow = true;
      });
      await page.getByRole("button", { name: "Abfrage ausführen" }).click();
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page
        .getByText("Datenbankübergreifende Abfrage wurde abgebrochen.", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Abfrage ausführen" }).waitFor();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as FixtureWindow).__federationCalls.filter(
              (call) => call.command === "cancel_execution",
            ).length,
        ),
      ).toBe(1);
      await page.getByRole("button", { name: "Abfrage ausführen" }).click();
      await page.waitForFunction(
        () =>
          (window as unknown as FixtureWindow).__federationCalls.filter(
            (call) => call.command === "federation_query",
          ).length === 3,
      );
      await page.evaluate(() => (window as unknown as FixtureWindow).__federationUnmount());
      await page.waitForFunction(
        () =>
          (window as unknown as FixtureWindow).__federationCalls.filter(
            (call) => call.command === "cancel_execution",
          ).length === 2,
      );
      const afterUnmount = await page.evaluate(
        () => (window as unknown as FixtureWindow).__federationCalls.length,
      );
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(() => (window as unknown as FixtureWindow).__federationCalls.length),
      ).toBe(afterUnmount);
      expect(errors).toEqual([]);
      console.log(
        `federation browser: 2 sources, 5000 catalog names, 10000 result rows, render ${duration.toFixed(1)} ms (<3000), DOM <200 rows, one execution, no idle polling, cancellation passes`,
      );
    } finally {
      await page.close();
      await browser.close();
    }
  },
  60_000,
);
