import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const enabled = Boolean(process.env.L8DB_BAAS_BROWSER);
const bridge = process.env.L8DB_BAAS_BRIDGE ?? "http://127.0.0.1:27032";
const appUrl = process.env.L8DB_BAAS_BROWSER_URL ?? "http://127.0.0.1:1432";
const supabaseUrl = process.env.L8DB_E2E_SUPABASE_URL ?? "";
const supabaseKey = process.env.L8DB_E2E_SUPABASE_KEY ?? "";
const convexUrl = process.env.L8DB_E2E_CONVEX_URL ?? "";
const convexKey = process.env.L8DB_E2E_CONVEX_KEY ?? "";
let browser: Browser;

async function pgQuery(query: string) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/pg/query`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`pg/query ${response.status}`);
}

async function deleteUiUser() {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` };
  const response = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers });
  const { users } = (await response.json()) as { users: { id: string; email: string }[] };
  for (const user of users.filter((item) => item.email === "ui-lab@example.com"))
    await fetch(`${base}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers });
}

async function openApp(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await page.addInitScript((bridge) => {
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
    );
    const host = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
      baasFailures: { command: string; error: string }[];
    };
    host.baasFailures = [];
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    host.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (/^(mcp_|automation_|team_)/.test(command)) return Promise.reject("not available");
        if (
          command.startsWith("plugin:") ||
          command.includes("extension") ||
          command === "list_ssh_tunnels"
        )
          return [];
        const response = await fetch(bridge, {
          method: "POST",
          body: JSON.stringify({ command, args }),
        });
        const value = await response.json();
        if (value.error !== undefined) {
          if (/^(supabase|convex)_/.test(command))
            host.baasFailures.push({ command, error: value.error });
          return Promise.reject(value.error);
        }
        return value.result;
      },
    };
  }, bridge);
  await page.goto(`${appUrl}/connections`);
  return errors;
}

async function withPage(name: string, body: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    const errors = await openApp(page);
    await body(page);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { baasFailures: unknown[] }).baasFailures),
    ).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: `test-artifacts/baas-ui/${name}-failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.close();
  }
}

async function startBaasConnection(page: Page, provider: string) {
  await page.getByRole("button", { name: "Neue Verbindung" }).first().click();
  await page.getByRole("button", { name: provider, exact: true }).click();
  await page.getByRole("button", { name: "Selbst gehostet" }).click();
}

beforeAll(async () => {
  if (!enabled) return;
  browser = await chromium.launch();
  await deleteUiUser();
  await pgQuery(
    "DROP TABLE IF EXISTS public.l8db_ui; CREATE TABLE public.l8db_ui (id int PRIMARY KEY, label text); INSERT INTO public.l8db_ui VALUES (1, 'erste Zeile'), (2, 'zweite Zeile')",
  );
});

afterAll(async () => {
  if (!enabled) return;
  await pgQuery("DROP TABLE IF EXISTS public.l8db_ui").catch(() => {});
  await deleteUiUser().catch(() => {});
  await browser?.close();
});

test.skipIf(!enabled)(
  "Supabase self-hosted: verbinden, Dienste, Tabellen, Storage, Auth, Datenbank, trennen",
  async () => {
    await withPage("supabase", async (page) => {
      await startBaasConnection(page, "Supabase");
      await page.getByLabel("API-URL, z. B. http://127.0.0.1:8000").fill("http://127.0.0.1:9");
      await page.getByLabel("service_role Key oder Secret API Key").fill(supabaseKey);
      await page.getByRole("button", { name: "Verbindung speichern" }).click();
      await page.getByRole("alert").filter({ hasText: "nicht erreichbar" }).waitFor();
      await page.evaluate(() => {
        (window as unknown as { baasFailures: unknown[] }).baasFailures.length = 0;
      });
      await page.getByLabel("API-URL, z. B. http://127.0.0.1:8000").fill(supabaseUrl);
      await page.getByLabel("Name (optional)").fill("Supabase Lab");
      await page.getByRole("button", { name: "Verbindung speichern" }).click();

      const card = page.locator("article").filter({ hasText: "Supabase Lab" });
      await card.waitFor();
      await expect(card.getByText(supabaseUrl, { exact: false }).count()).resolves.toBe(1);
      await card.getByRole("button", { name: "Verbinden" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Benutzer").waitFor();
      expect(await dialog.getByLabel("Benutzer").inputValue()).toBe("postgres.your-tenant-id");
      await dialog.getByLabel("Port").fill(process.env.L8DB_E2E_SUPABASE_DB_PORT ?? "5432");
      await dialog
        .getByLabel("Datenbankpasswort")
        .fill(process.env.L8DB_E2E_SUPABASE_DB_PASSWORD ?? "");
      await dialog.getByRole("button", { name: "Verbinden" }).click();
      await card.getByRole("button", { name: "SQL öffnen" }).waitFor();
      expect(await page.locator("article").filter({ hasText: "Supabase Lab" }).count()).toBe(1);

      await card.getByRole("button", { name: "Projekt öffnen" }).last().click();
      await page.getByRole("heading", { level: 2, name: "Supabase Lab" }).waitFor();
      await page.getByText("ACTIVE_HEALTHY").nth(4).waitFor();
      expect(await page.getByText("ACTIVE_HEALTHY").count()).toBe(5);
      expect(await page.getByRole("heading", { name: "Projekt API Key" }).count()).toBe(0);
      expect(await page.getByRole("heading", { name: "Edge Functions" }).count()).toBe(0);
      expect(await page.getByText("pg-meta der Instanz").count()).toBe(1);
      expect(await page.getByRole("button", { name: "Supabase Studio" }).count()).toBe(1);

      const table = page.getByRole("button", { name: /^l8db_ui public/ });
      await page.getByText("Datenbanktabellen").waitFor();
      for (let pageIndex = 0; pageIndex < 10 && !(await table.isVisible()); pageIndex++) {
        await page.getByRole("button", { name: "Weitere Tabellen" }).click();
        await page.waitForTimeout(500);
      }
      await table.click();
      await page.getByText("zweite Zeile").waitFor();

      await page
        .getByText("Keine Buckets vorhanden.")
        .or(page.getByText("Bucket-Details"))
        .first()
        .waitFor();
      await page.getByPlaceholder("E-Mail").fill("ui-lab@example.com");
      await page.getByPlaceholder("Passwort").fill("secret-pw");
      await page.getByPlaceholder("Passwort").press("Enter");
      await page.getByText("ui-lab@example.com").first().waitFor();

      await page.getByRole("button", { name: "Trennen" }).click();
      await page.getByRole("heading", { name: "Supabase verbinden" }).waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Convex self-hosted: verbinden, Umgebungsvariablen, trennen",
  async () => {
    await withPage("convex", async (page) => {
      await startBaasConnection(page, "Convex");
      await page.getByLabel("Backend-URL, z. B. http://127.0.0.1:3210").fill(convexUrl);
      await page.getByLabel("Admin-Key").fill(convexKey);
      await page.getByRole("button", { name: "Verbindung speichern" }).click();

      const card = page.locator("article").filter({ hasText: "Convex (selbst gehostet)" });
      await card.waitFor();
      await card.getByRole("button", { name: "Projekt öffnen" }).last().click();
      await page.getByText("Selbst gehostetes Deployment").waitFor();
      await page.getByLabel("Variablenname").fill("L8DB_UI_LAB");
      await page.getByLabel("Variablenwert").fill("1");
      await page.getByLabel("Variablenwert").press("Enter");
      await page.getByText("L8DB_UI_LAB gespeichert.").waitFor();
      await page.getByText("L8DB_UI_LAB", { exact: true }).waitFor();
      await page.getByRole("button", { name: "L8DB_UI_LAB löschen" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
      await page.getByText("L8DB_UI_LAB", { exact: true }).waitFor({ state: "detached" });

      await page.getByRole("button", { name: "Trennen" }).click();
      await page.getByRole("heading", { name: "Convex verbinden" }).waitFor();
    });
  },
  120_000,
);
