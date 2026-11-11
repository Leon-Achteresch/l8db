import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";

function mockTauriInit(seeds: Record<string, string>) {
  const runtime = window as unknown as {
    __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    __tourCalls: string[];
  };
  runtime.__tourCalls = [];
  const aiReady = seeds["test.ai"] === "ready";
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
      runtime.__tourCalls.push(cmd);
      if (cmd === "ai_status" && aiReady)
        return { provider: "codex", installed: true, version: "1", keyStored: false };
      if (cmd === "ai_complete") {
        await new Promise((done) => setTimeout(done, 150));
        return {
          text: "Im SQL-Editor drückst du ⌘↵ oder klickst auf Ausführen.\n```feature\nquery.run\n```",
          truncated: false,
          model: "test",
        };
      }
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
  for (const [key, value] of Object.entries(seeds))
    if (!key.startsWith("test.")) localStorage.setItem(key, value);
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
    spotlight: document.querySelectorAll('[data-tour-ui="spotlight"]').length,
    mascot: document.querySelectorAll('[data-tour-ui="mascot"]').length,
  }));
}

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Tour-Angebot blockiert das Anlegen einer Verbindung nicht",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      expect(await page.locator('[data-tour-ui="overview"]').count()).toBe(0);
      const state = await tourState(page);
      expect(state.spotlight).toBe(0);
      await page.locator('[data-tour="connection-add"]').first().click({ timeout: 8000 });
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="offer"]').count()).toBe(1);
      expect(errors.join("\n")).toBe("");
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
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      const overview = page.locator('[data-tour-ui="overview"]');
      await overview.waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toMatch(/^1\//);
      expect(await page.locator('[data-tour-ui="step-body"]').first().innerText()).not.toBe("");
      let state = await tourState(page);
      expect(state.spotlight).toBe(0);
      expect(state.mascot).toBe(1);
      expect(await page.getByLabel("Frage an Lumi").count()).toBe(0);
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.waitForTimeout(1200);
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toMatch(/^2\//);
      state = await tourState(page);
      expect(state.spotlight).toBe(1);
      await page.getByRole("button", { name: "Tour minimieren", exact: true }).click();
      await page.locator('[data-tour-ui="overview-minimized"]').waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      state = await tourState(page);
      expect(state.spotlight).toBe(0);
      expect(state.mascot).toBe(0);
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
      expect(errors.join("\n")).toBe("");
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
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, ONBOARDED);
      await page.goto(`http://localhost:${server.port}/connections`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      await page.locator('[data-tour-ui="chapter-toggle"]').click();
      await page
        .locator('[data-tour-ui="overview"]')
        .getByRole("button", { name: /Fragen stellen/ })
        .first()
        .click();
      await page.waitForTimeout(1200);
      expect(page.url()).toContain("/query");
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toMatch(
        /^\d+\/\d+$/,
      );
      await page.locator('[data-tour-ui="chapter-toggle"]').click();
      await page
        .locator('[data-tour-ui="overview"]')
        .getByRole("button", { name: /Verbindung anlegen/ })
        .first()
        .click();
      await page.waitForTimeout(1200);
      expect(page.url()).toContain("/connections");
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.waitForTimeout(1000);
      await page.getByLabel("Autopilot", { exact: true }).check();
      await page.locator('[data-tour="connection-editor"]').waitFor({ timeout: 10000 });
      expect(errors.join("\n")).toBe("");
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
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
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
        return "free";
      });
      expect(covered).toBe("free");
      await saveArea.getByRole("button", { name: "Speichern" }).focus();
      await page.keyboard.press("Enter");
      await page.getByText("Tour Test").first().waitFor({ timeout: 10000 });
      expect(await page.locator('[data-tour-ui="overview-minimized"]').count()).toBe(1);
      expect(errors.join("\n")).toBe("");
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
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
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
      for (let step = 0; step < 90; step++) {
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
      expect(errors.join("\n")).toBe("");
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
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
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
      expect(await page.locator('[data-tour-ui="progress"]').first().innerText()).toMatch(/^1\//);
      expect(errors.join("\n")).toBe("");
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);

const CONNECTED = {
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
};

async function box(page: Page, selector: string) {
  const element = page.locator(selector).first();
  return (await element.count()) > 0 ? element.boundingBox() : null;
}

async function settled(page: Page) {
  const read = () =>
    page.evaluate(() =>
      [
        '[data-tour-ui="mascot"]',
        '[data-tour-ui="overview"]',
        '[data-tour-ui="spotlight"]',
        "[data-walking]",
      ]
        .map((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",") : "-";
        })
        .join("|"),
    );
  let previous = await read();
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(250);
    const current = await read();
    if (current === previous && current.endsWith("|-")) return;
    previous = current;
  }
  throw new Error(`Tour kommt nicht zur Ruhe: ${previous}`);
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Lumi läuft zum Ziel, zeigt darauf und verdeckt es nicht",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, CONNECTED);
      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      const mascot = page.locator('[data-tour-ui="mascot"]');
      await mascot.waitFor({ timeout: 8000 });
      for (let step = 0; step < 10; step++) {
        const overview = page.locator('[data-tour-ui="overview"]');
        const skip = overview.getByRole("button", { name: "Überspringen", exact: true });
        if ((await skip.count()) > 0) await skip.click();
        else await overview.getByRole("button", { name: "Weiter", exact: true }).click();
        await settled(page);
        const spotlight = await box(page, '[data-tour-ui="spotlight"]');
        if (!spotlight) continue;
        const lumi = await box(page, '[data-tour-ui="mascot"]');
        const bubble = await box(page, '[data-tour-ui="overview"]');
        if (!lumi || !bubble) throw new Error("Lumi oder Sprechblase fehlt");
        const target = {
          x: spotlight.x + 8,
          y: spotlight.y + 8,
          width: spotlight.width - 16,
          height: spotlight.height - 16,
        };
        if (target.width * target.height < 1440 * 900 * 0.3) {
          expect(overlaps(lumi, target)).toBe(false);
          expect(overlaps(bubble, target)).toBe(false);
        }
        expect(lumi.x).toBeGreaterThanOrEqual(0);
        expect(lumi.x + lumi.width).toBeLessThanOrEqual(1440);
        expect(bubble.y + bubble.height).toBeLessThanOrEqual(900);
      }
      expect(errors.join("\n")).toBe("");
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Fragen an Lumi: Antwort, Zeig mir, zurück zur Tour",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, { ...CONNECTED, "test.ai": "ready" });
      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="chapter-toggle"]').click();
      await page
        .locator('[data-tour-ui="overview"]')
        .getByRole("button", { name: /Fragen stellen/ })
        .first()
        .click();
      await page.waitForURL(/\/query/, { timeout: 8000 });
      const titleBefore = "Der SQL-Editor";
      await page
        .locator('[data-tour-ui="step-title"]', { hasText: titleBefore })
        .waitFor({ timeout: 8000 });
      const input = page.getByLabel("Frage an Lumi");
      await input.waitFor({ timeout: 8000 });
      await input.fill("Wie führe ich eine Abfrage aus?");
      await page.keyboard.press("ArrowRight");
      expect(await page.locator('[data-tour-ui="step-title"]').first().innerText()).toBe(
        titleBefore,
      );
      await page.getByRole("button", { name: "Frage senden" }).click();
      await page.getByRole("status", { name: "Lumi denkt nach" }).waitFor({ timeout: 3000 });
      expect(await page.locator('[data-tour-ui="mascot"] svg').getAttribute("data-mood")).toBe(
        "thinking",
      );
      const answer = page.locator('[data-tour-ui="answer"]');
      await answer.getByText("⌘↵").waitFor({ timeout: 8000 });
      expect(await answer.innerText()).not.toContain("```");
      await answer.getByRole("button", { name: "Zeig mir: Abfrage ausführen" }).click();
      await page.locator('[data-tour-ui="feature"]').waitFor({ timeout: 8000 });
      expect(await page.locator('[data-tour-ui="step-title"]').first().innerText()).toBe(
        "Abfrage ausführen",
      );
      await page.locator('[data-tour-ui="spotlight"]').waitFor({ timeout: 8000 });
      const anchor = await box(page, '[data-feature="query.run"]');
      const spotlight = await box(page, '[data-tour-ui="spotlight"]');
      expect(anchor && spotlight && overlaps(anchor, spotlight)).toBe(true);
      await page.getByRole("button", { name: "Zurück zur Tour" }).click();
      await page.locator('[data-tour-ui="feature"]').waitFor({ state: "hidden", timeout: 8000 });
      expect(await page.locator('[data-tour-ui="step-title"]').first().innerText()).toBe(
        titleBefore,
      );
      await answer.getByRole("button", { name: "Zeig mir: Abfrage ausführen" }).waitFor({
        timeout: 5000,
      });
      await answer.getByRole("button", { name: "Zeig mir: Abfrage ausführen" }).click();
      await page.locator('[data-tour-ui="feature"]').waitFor({ timeout: 8000 });
      await page.keyboard.press("ArrowRight");
      await page.locator('[data-tour-ui="feature"]').waitFor({ state: "hidden", timeout: 8000 });
      expect(await page.locator('[data-tour-ui="step-title"]').first().innerText()).toBe(
        titleBefore,
      );
      const calls = await page.evaluate(
        () => (window as unknown as { __tourCalls: string[] }).__tourCalls,
      );
      expect(calls.filter((cmd) => cmd === "ai_complete")).toHaveLength(1);
      expect(calls.filter((cmd) => cmd === "ai_status").length).toBeLessThanOrEqual(2);
      expect(errors.join("\n")).toBe("");
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);

test.skipIf(!process.env.L8DB_TOUR_BROWSER)(
  "Performance: Schrittwechsel, DOM-Größe und Leerlauf",
  async () => {
    const server = await createServer();
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
    });
    try {
      await page.addInitScript(mockTauriInit, CONNECTED);
      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('[data-tour-ui="offer"]').waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Tour starten", exact: true }).click();
      await page.locator('[data-tour-ui="overview"]').waitFor({ timeout: 8000 });
      const samples: number[] = [];
      for (let step = 0; step < 14; step++) {
        samples.push(
          await page.evaluate(
            () =>
              new Promise<number>((done, fail) => {
                const progress = () =>
                  document.querySelector('[data-tour-ui="progress"]')?.textContent;
                const before = progress();
                const buttons = Array.from(
                  document.querySelectorAll<HTMLButtonElement>('[data-tour-ui="overview"] button'),
                );
                const next = buttons.find((button) =>
                  ["Weiter", "Überspringen"].includes(button.textContent?.trim() ?? ""),
                );
                if (!next) return fail(new Error("Kein Weiter-Knopf"));
                const started = performance.now();
                const observer = new MutationObserver(() => {
                  if (progress() === before) return;
                  observer.disconnect();
                  requestAnimationFrame(() => done(performance.now() - started));
                });
                observer.observe(document.body, {
                  subtree: true,
                  childList: true,
                  characterData: true,
                });
                next.click();
              }),
          ),
        );
        await page.waitForTimeout(350);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      const p95 = samples[Math.floor(samples.length * 0.95)];
      await page.waitForFunction(
        () => !document.querySelector('[data-tour-ui="mascot"][data-walking]'),
        undefined,
        { timeout: 8000 },
      );
      await page.waitForTimeout(1600);
      const idle = await page.evaluate(
        () =>
          new Promise<{ mutations: number; nodes: number; frames: number }>((done) => {
            let mutations = 0;
            let frames = 0;
            const observer = new MutationObserver((records) => {
              mutations += records.length;
            });
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
            const original = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (callback) => {
              frames += 1;
              return original(callback);
            };
            setTimeout(() => {
              observer.disconnect();
              window.requestAnimationFrame = original;
              const nodes = Array.from(document.querySelectorAll("[data-tour-ui]")).filter(
                (node) => !node.parentElement?.closest("[data-tour-ui]"),
              );
              done({
                mutations,
                frames,
                nodes: nodes.reduce((sum, node) => sum + node.querySelectorAll("*").length + 1, 0),
              });
            }, 2000);
          }),
      );
      const calls = await page.evaluate(
        () => (window as unknown as { __tourCalls: string[] }).__tourCalls,
      );
      console.info(
        `tour steps: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, idle mutations ${idle.mutations}, idle rAF ${idle.frames}, tour DOM ${idle.nodes}`,
      );
      expect(median).toBeLessThan(120);
      expect(p95).toBeLessThan(400);
      expect(idle.mutations).toBeLessThanOrEqual(6);
      expect(idle.frames).toBeLessThanOrEqual(12);
      expect(idle.nodes).toBeLessThan(260);
      expect(calls.filter((cmd) => cmd === "ai_complete")).toHaveLength(0);
      expect(errors.join("\n")).toBe("");
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
