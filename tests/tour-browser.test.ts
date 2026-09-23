import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";

function mockTauriInit(seeds: Record<string, string>) {
  const runtime = window as unknown as {
    __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  };
  const keychain = new Map<string, string>();
  const providers = [
    {
      id: "postgres",
      name: "postgres",
      group: "postgres",
      kind: "postgres",
      default_port: 5432,
      file_based: false,
      url_schemes: ["postgresql", "postgres"],
      placeholder: "",
      hint: "",
      hosts: ["localhost"],
      driver: { type: "builtin" },
      capabilities: { ssl: true, ssh: true, views: true, read_only_mode: true },
      driver_status: { available: true, detail: "", install: [] },
    },
  ];
  runtime.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback: () => Math.floor(Math.random() * 1e9),
    convertFileSrc: (p: string) => p,
    plugins: {},
    invoke: async (cmd: string, args?: unknown) => {
      const input = (args ?? {}) as Record<string, unknown>;
      if (cmd === "list_providers") return providers;
      if (cmd === "list_databases") return ["demo"];
      if (cmd === "list_schemas") return ["public"];
      if (cmd === "list_tables") return [{ schema: "public", name: "users" }];
      if (cmd === "list_views") return [];
      if (cmd === "list_table_columns_detailed")
        return [
          { name: "id", data_type: "integer", is_primary_key: true },
          { name: "name", data_type: "text", is_primary_key: false },
        ];
      if (cmd === "list_foreign_keys") return [];
      if (cmd === "get_er_schema") return { tables: [], foreign_keys: [] };
      if (cmd === "fetch_table_rows") return { columns: ["id"], rows: [{ id: 1 }] };
      if (cmd === "count_table_rows") return 1;
      if (cmd === "count_table_rows_capped") return { count: 1, exact: true, estimate: null };
      if (cmd === "execute_query")
        return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
      if (cmd === "store_secret") {
        keychain.set(String(input.account), String(input.secret));
        return null;
      }
      if (cmd === "load_secret") return keychain.get(String(input.account)) ?? null;
      if (cmd === "delete_secret") {
        keychain.delete(String(input.account));
        return null;
      }
      return null;
    },
  };
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  localStorage.clear();
  for (const [key, value] of Object.entries(seeds)) localStorage.setItem(key, value);
}
const ONBOARDED = {
  "l8db.settings": JSON.stringify({ state: { onboardingDone: true }, version: 0 }),
};

async function createServer() {
  const root = resolve("dist");
  const policy = Object.entries(config.app.security.csp)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = resolve(root, `.${new URL(request.url).pathname}`);
      if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
      if (path !== root && (await Bun.file(path).exists())) return new Response(Bun.file(path));
      return new Response(Bun.file(resolve(root, "index.html")), {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": policy },
      });
    },
  });
}

async function launchBrowser(): Promise<Browser> {
  return (process.env.L8DB_TOUR_BROWSER === "webkit" ? webkit : chromium).launch();
}

async function tourState(page: Page) {
  return page.evaluate(() => ({
    tour: JSON.parse(localStorage.getItem("l8db.tour") ?? "{}") as Record<string, unknown>,
    settings: JSON.parse(localStorage.getItem("l8db.settings") ?? "{}") as Record<string, unknown>,
    overlay: document.querySelectorAll(
      "svg.driver-overlay, .driver-overlay, #driver-overlay, #driver-page-overlay",
    ).length,
    popover: document.querySelectorAll(".driver-popover").length,
  }));
}

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Tour-Angebot blockiert das Anlegen einer Verbindung nicht",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      expect(await page.locator('[data-tour-ui="overview"]').count()).toBe(0);
      const state = await tourState(page);
      expect(state.overlay).toBe(0);
      await page.locator('[data-tour="connection-add"]').first().click({ timeout: 8000 });
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="offer"]').count()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Tour starten, minimieren, einblenden, beenden",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      const overview = page.locator('[data-tour-ui="overview"]');
      await overview.waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toContain(
        "Schritt 1 von",
      );
      expect(await page.locator('[data-tour-ui="step-body"]').first().innerText()).not.toBe("");
      let state = await tourState(page);
      expect(state.overlay).toBe(0);
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.waitForTimeout(1200);
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toContain(
        "Schritt 2 von",
      );
      state = await tourState(page);
      expect(state.popover).toBeGreaterThan(0);
      expect(state.overlay).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Tour minimieren", exact: true }).click();
      await page.locator('[data-tour-ui="overview-minimized"]').waitFor({ timeout: 5000 });
      state = await tourState(page);
      expect(state.overlay).toBe(0);
      expect(state.popover).toBe(0);
      await page.locator('[data-tour="connection-add"]').first().click({ timeout: 8000 });
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 8000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Tour einblenden" }).first().click();
      await overview.waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "Tour beenden", exact: true }).click();
      await overview.waitFor({ state: "hidden", timeout: 5000 });
      state = await tourState(page);
      expect((state.settings.state as Record<string, unknown> | undefined)?.tourFinished).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Kapitelliste springt, Autopilot öffnet den Editor",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      await page.locator('[data-tour-ui="chapter-toggle"]').click();
      await page
        .locator('[data-tour-ui="overview"]')
        .getByRole("button", { name: /SQL-Arbeitsplatz/ })
        .first()
        .click();
      await page.waitForTimeout(1200);
      expect(page.url()).toContain("/query");
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toContain(
        "Schritt",
      );
      await page.locator('[data-tour-ui="chapter-toggle"]').click();
      await page
        .locator('[data-tour-ui="overview"]')
        .getByRole("button", { name: /Verbindungen/ })
        .first()
        .click();
      await page.waitForTimeout(1200);
      expect(page.url()).toContain("/connections");
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.waitForTimeout(1000);
      await page.getByLabel("Autopilot", { exact: true }).check();
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 10000 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Verbindung speichern, während die Tour minimiert ist",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      await page.getByRole("button", { name: "Tour minimieren", exact: true }).click();
      await page.locator('[data-tour-ui="overview-minimized"]').waitFor({ timeout: 5000 });
      await page.locator('[data-tour="connection-add"]').first().click({ timeout: 8000 });
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 8000 });
      await page.getByRole("button", { name: "postgres", exact: true }).first().click();
      await page.getByRole("main").getByRole("button", { name: "Weiter", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("Tour Test");
      await page.getByLabel("Benutzer", { exact: true }).fill("demo");
      await page.getByLabel("Datenbank", { exact: true }).fill("demo");
      await page.getByLabel("Passwort", { exact: true }).fill("demo");
      const saveArea = page.locator('[data-tour="connection-save"]');
      await saveArea.scrollIntoViewIfNeeded();
      const covered = await page.evaluate(() => {
        const area = document.querySelector("[data-tour='connection-save']");
        if (!area) return "missing";
        const rect = area.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        ) as HTMLElement | null;
        if (!hit) return "none";
        if (hit.closest('[data-tour-ui="overview-minimized"]')) return "tour-pill";
        if (hit.closest('[data-tour-ui="overview"]')) return "tour-panel";
        if (hit.closest(".driver-popover")) return "tour-popover";
        return "free";
      });
      expect(covered).toBe("free");
      await saveArea.getByRole("button", { name: "Speichern" }).focus();
      await page.keyboard.press("Enter");
      await page.getByText("Tour Test").first().waitFor({ timeout: 10000 });
      expect(await page.locator('[data-tour-ui="overview-minimized"]').count()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "komplette Tour lässt sich bis zum Ende durchklicken",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, {
        ...ONBOARDED,
        "l8db.connections": JSON.stringify({
          state: {
            connections: [
              {
                id: "tour",
                name: "Tour Demo",
                kind: "postgres",
                connectionString: "postgres://demo@localhost/demo",
                sslMode: "disable",
              },
            ],
            activeId: "tour",
            favoriteServerKeys: [],
            serverOrder: [],
          },
          version: 0,
        }),
      });
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      const seen: string[] = [];
      for (let step = 0; step < 45; step++) {
        const overview = page.locator('[data-tour-ui="overview"]');
        if ((await overview.count()) === 0) break;
        const title = await page.locator('[data-tour-ui="step-title"]').first().innerText();
        const body = await page.locator('[data-tour-ui="step-body"]').first().innerText();
        expect(body.trim().length).toBeGreaterThan(0);
        seen.push(title);
        const skip = overview.getByRole("button", { name: "Überspringen", exact: true });
        if ((await skip.count()) > 0) await skip.click();
        else await overview.getByRole("button", { name: "Weiter", exact: true }).click();
        await page.waitForTimeout(500);
      }
      expect(seen.length).toBeGreaterThanOrEqual(20);
      expect(new Set(seen).size).toBeGreaterThanOrEqual(15);
      await page.locator('[data-tour-ui="overview"]').waitFor({ state: "hidden", timeout: 8000 });
      const state = await tourState(page);
      expect((state.settings.state as Record<string, unknown> | undefined)?.tourFinished).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Tour lässt sich aus den Einstellungen neu starten",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(mockTauriInit, {
        "l8db.settings": JSON.stringify({
          state: { tourFinished: true, onboardingDone: true },
          version: 0,
        }),
      });
      await page.goto(`http://localhost:${server.port}/settings`);
      expect(await page.locator('[data-tour-ui="offer"]').count()).toBe(0);
      expect(await page.locator('[data-tour-ui="overview"]').count()).toBe(0);
      await page.getByRole("button", { name: "Tour von vorn", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toContain(
        "Schritt 1 von",
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
