import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedSupabaseStudio } from "./fixtures/supabase-studio-mock";

const enabled = Boolean(process.env.L8DB_PAYMENTS_BROWSER);
const appUrl = process.env.L8DB_SUPABASE_STUDIO_URL ?? "http://localhost:1420";
let browser: Browser;

type PaymentsWindow = {
  __payments: { command: string; args: Record<string, unknown> }[];
  __paymentsFail: number;
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => unknown };
};

async function openPayments() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedSupabaseStudio(page);
  await page.addInitScript(() => {
    const REF = "abcdefghijklmnopqrst";
    const state = window as unknown as PaymentsWindow;
    state.__payments = [];
    state.__paymentsFail = 0;
    const products = Array.from({ length: 100 }, (_, index) => ({
      id: `prod_${index.toString().padStart(4, "0")}`,
      object: "product",
      name: `Plan ${index}`,
      active: index % 9 !== 0,
      created: 1_760_000_000 + index,
      metadata: index % 4 === 0 ? {} : { l8db_project: REF },
    }));
    const original = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = (command, args = {}) => {
      if (!command.startsWith("payments_")) return original(command, args);
      state.__payments.push({ command, args });
      switch (command) {
        case "payments_status":
          return Promise.resolve({
            connected: true,
            test_mode: true,
            account_id: "acct_browser",
            origin: "https://app.example.com",
            webhook_id: "we_1",
            setup_current: true,
          });
        case "payments_list":
          return Promise.resolve({
            data: args.cursor
              ? products
                  .slice(0, 20)
                  .map((row) => ({ ...row, id: `${row.id}b`, name: `${row.name}b` }))
              : products,
            has_more: !args.cursor,
            next_cursor: args.cursor ? null : "page_2",
          });
        case "payments_mutate":
          if (state.__paymentsFail > 0) {
            state.__paymentsFail--;
            return Promise.reject("Stripe ist nicht erreichbar.");
          }
          return Promise.resolve({ id: "prod_new", name: "Neu", active: true });
        default:
          return Promise.resolve(null);
      }
    };
  });
  const started = performance.now();
  await page.goto(`${appUrl}/baas?provider=supabase&studio=payments`);
  return { page, errors, started };
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as PaymentsWindow).__payments);

beforeAll(async () => {
  if (enabled) browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

test.skipIf(!enabled)(
  "lädt Produkte einmal, zeigt Bereich und wiederholt Fehlversuche mit derselben Anfrage-ID",
  async () => {
    const { page, errors, started } = await openPayments();
    await page.getByText("Plan 1", { exact: true }).waitFor();
    const openMs = performance.now() - started;
    await expect(page.getByText("Testmodus").count()).resolves.toBeGreaterThan(0);
    await page.getByText(/Stripe-Suche nach Metadatum l8db_project/).waitFor();
    const table = page.locator("table").filter({ hasText: "Plan 1" });
    expect(await table.locator("tbody tr").count()).toBe(100);
    await page.waitForTimeout(1000);
    const idle = await calls(page);
    expect(idle.filter((entry) => entry.command === "payments_list")).toHaveLength(1);
    expect(idle.filter((entry) => entry.command === "payments_status")).toHaveLength(1);

    await page.getByRole("button", { name: "Weitere laden" }).click();
    await page.getByText("120 Einträge geladen", { exact: false }).waitFor();

    await page.evaluate(() => {
      (window as unknown as PaymentsWindow).__paymentsFail = 1;
    });
    await page.getByLabel("Produktname").fill("Neu");
    await page.getByRole("button", { name: "Produkt anlegen" }).click();
    await page.getByText("Stripe ist nicht erreichbar.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Produkt anlegen" }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as PaymentsWindow).__payments.filter(
          (entry) => entry.command === "payments_mutate",
        ).length === 2,
    );
    const mutations = (await calls(page)).filter((entry) => entry.command === "payments_mutate");
    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.args.requestId).toBe(mutations[1]?.args.requestId);
    expect(await page.content()).not.toContain("sk_test");
    expect(errors).toEqual([]);
    await reportScenario("payments-browser-open", {
      openMs,
      rows: 100,
      listRequestsAfterIdle: 1,
      mutationAttempts: mutations.length,
    });
    expect(openMs).toBeLessThan(Number(process.env.L8DB_PAYMENTS_OPEN_MS ?? 8000));
    await page.close();
  },
  60_000,
);
