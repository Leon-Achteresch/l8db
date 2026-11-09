import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";

const engine =
  process.env.L8DB_STORAGE_BROWSER ??
  process.env.L8DB_PRODUCTION_BROWSER ??
  (process.env.L8DB_PERF_APP ? "1" : undefined);
const SCREENSHOT = process.env.L8DB_STORAGE_SCREENSHOT;

function serve() {
  const root = resolve(import.meta.dir, "../dist");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const file = Bun.file(resolve(root, `.${pathname}`));
      if (pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file(resolve(root, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
}

async function fillLegacyStorage(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { nativeStorage: window.localStorage });
    if (sessionStorage.getItem("legacy-seeded")) return;
    sessionStorage.setItem("legacy-seeded", "1");
    const pkg = (name: string) =>
      [
        `CREATE OR REPLACE PACKAGE BODY HR.${name} AS`,
        ...Array.from(
          { length: 220 },
          (_, i) =>
            `  PROCEDURE proc_${i}(p_id IN NUMBER) IS BEGIN UPDATE hr.employees SET salary = salary * 1.01 WHERE employee_id = p_id; END proc_${i};`,
        ),
        `END ${name};`,
      ].join("\n");
    const tabsByConnection = Object.fromEntries(
      ["perf", "ora1", "ora2", "ora3", "ora4", "ora5"].map((id) => [
        id,
        Array.from({ length: 5 }, (_, i) => {
          const sql = pkg(`PKG_${id}_${i}`);
          return {
            kind: "query",
            id: `${id}-${i}`,
            title: `Query ${i + 1}`,
            sql,
            savedSql: sql,
            lastExecutedSql: sql,
          };
        }),
      ]),
    );
    const closed = Array.from({ length: 100 }, (_, i) => {
      const sql = pkg(`CLOSED_${i}`);
      return {
        kind: "query",
        id: `c${i}`,
        title: `Query ${i}`,
        sql,
        lastExecutedSql: sql,
        recoveryId: `r${i}`,
        closedAt: 1,
        closedConnectionId: "ora1",
      };
    });
    for (let count = 0; count <= closed.length; count += 2) {
      try {
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            state: { tabsByConnection, recentlyClosed: closed.slice(0, count) },
            version: 4,
          }),
        );
      } catch {
        break;
      }
    }
    let filler = "";
    for (let size = 65_536; size >= 16; ) {
      try {
        localStorage.setItem(
          "l8db.palette-history",
          JSON.stringify({ state: { recent: [filler + "x".repeat(size)] }, version: 0 }),
        );
        filler += "x".repeat(size);
      } catch {
        size = Math.floor(size / 2);
      }
    }
    localStorage.setItem(
      "l8db.palette-history",
      JSON.stringify({ state: { recent: [filler.slice(2000)] }, version: 0 }),
    );
  });
}

const ready = (page: Page) =>
  page.getByLabel("Neue Abfrage öffnen").first().waitFor({ timeout: 30_000 });

const storageInitMs = (page: Page) =>
  page.evaluate(() => {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const entry = resources.find((item) => /\/assets\/index-[^/]+\.js$/.test(item.name));
    const bootstrap = resources.find((item) => /\/assets\/bootstrap-[^/]+\.js$/.test(item.name));
    return entry && bootstrap ? bootstrap.startTime - entry.responseEnd : -1;
  });

const launch = (): Promise<Browser> => (engine === "webkit" ? webkit : chromium).launch();

test.skipIf(!engine)(
  "a full localStorage moves to IndexedDB, keeps saving and is manageable in settings",
  async () => {
    const server = serve();
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
      });
      await seedApp(page, 4, { rows: 2, columns: 2 });
      await fillLegacyStorage(page);
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await ready(page);
      const migrationMs = await storageInitMs(page);

      const native = await page.evaluate(() => {
        const storage = (window as unknown as { nativeStorage: Storage }).nativeStorage;
        return Array.from({ length: storage.length }, (_, index) => storage.key(index));
      });
      expect(native).not.toContain("l8db.table-tabs");
      expect(native).toContain("l8db.connections");
      expect(native).toContain("l8db.storage.migrated");
      const storedChars = await page.evaluate(() => {
        let chars = 0;
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index) ?? "";
          chars += key.length + (localStorage.getItem(key)?.length ?? 0);
        }
        return chars;
      });
      expect(storedChars).toBeGreaterThan(5_000_000);

      await page.getByLabel("Neue Abfrage öffnen").first().click();
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.type("SELECT * FROM hr.employees WHERE department_id = 50");
      await page.waitForTimeout(800);
      expect(await page.getByText("Lokaler Speicher ist voll").count()).toBe(0);

      await page.reload();
      await ready(page);
      const reloadMs = await storageInitMs(page);
      expect(
        await page.evaluate(
          () => localStorage.getItem("l8db.table-tabs")?.includes("department_id = 50") ?? false,
        ),
      ).toBe(true);

      await page.goto(`http://127.0.0.1:${server.port}/settings?tab=storage`);
      await page.getByRole("heading", { name: "Speicher", exact: true }).waitFor();
      const areas = page.getByRole("region", { name: "Datenbereiche" });
      await areas.getByText("Tabs", { exact: true }).waitFor();
      await page
        .getByRole("region", { name: "Verbindungen" })
        .getByRole("button", { name: /perf/ })
        .click();
      await page.getByText(/Offene Tabs · \d+/).waitFor();
      if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT, fullPage: true });

      await areas.getByRole("button", { name: "Befehlsverlauf löschen" }).click();
      await page.getByRole("button", { name: "Löschen", exact: true }).click();
      await page.waitForEvent("load");
      await page.getByRole("heading", { name: "Speicher", exact: true }).waitFor();
      expect(await page.evaluate(() => localStorage.getItem("l8db.palette-history"))).toBeNull();
      expect(errors).toEqual([]);

      expect(migrationMs).toBeLessThan(1500);
      expect(reloadMs).toBeLessThan(200);
      await reportScenario(`storage-init-${engine === "webkit" ? "webkit" : "chromium"}`, {
        migrationMs,
        reloadMs,
        storedChars,
        databaseRequests: 0,
        limits: { migrationMs: 1500, reloadMs: 200 },
      });
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120_000,
);

test.skipIf(!engine)(
  "changes in one window reach the other window",
  async () => {
    const server = serve();
    const browser = await launch();
    try {
      const context = await browser.newContext();
      const first = await context.newPage();
      const second = await context.newPage();
      for (const page of [first, second]) {
        await seedApp(page, 2, { rows: 2, columns: 2 });
        await page.goto(`http://127.0.0.1:${server.port}/`);
        await ready(page);
      }
      await second.evaluate(() => {
        const seen: string[] = [];
        Object.assign(window, { seen });
        window.addEventListener("storage", (event) => {
          if (event.key === "l8db.probe" && event.newValue) seen.push(event.newValue);
        });
      });
      await first.evaluate(() => localStorage.setItem("l8db.probe", "hello"));
      await second.waitForFunction(
        () =>
          (window as unknown as { seen: string[] }).seen.includes("hello") &&
          localStorage.getItem("l8db.probe") === "hello",
      );
      await first.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
        settings.state.uiScale = 110;
        localStorage.setItem("l8db.settings", JSON.stringify(settings));
      });
      await second.waitForFunction(() => document.documentElement.dataset.uiScale === "110");
      await second.evaluate(() => Object.assign(window, { alive: true }));
      await first.goto(`http://127.0.0.1:${server.port}/settings?tab=storage`);
      const areas = first.getByRole("region", { name: "Datenbereiche" });
      await areas.getByRole("button", { name: "Dashboards löschen", exact: true }).click();
      await first.getByRole("button", { name: "Löschen", exact: true }).click();
      await second.waitForFunction(() => !(window as unknown as { alive?: boolean }).alive);
      await ready(second);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60_000,
);
