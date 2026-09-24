import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_COMPARE_BROWSER)(
  "Vergleich fragt vor dem Laden einer Zielverbindung nach dem fehlenden Passwort",
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
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await seedApp(page, 2, { rows: 2, columns: 2 });
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "null");
        stored.state.connections.push({
          ...stored.state.connections[0],
          id: "target",
          name: "Ziel ohne Passwort",
          connectionString: "postgresql://leon@target.test:5432/l8db_perf",
        });
        localStorage.setItem("l8db.connections", JSON.stringify(stored));
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          targetCalls: { command: string; authenticated: boolean }[];
        };
        const invoke = host.__TAURI_INTERNALS__.invoke;
        host.targetCalls = [];
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          const url = String(args?.connectionString ?? "");
          if (url.includes("target.test")) {
            const authenticated = new URL(url).password === "test-password";
            host.targetCalls.push({ command, authenticated });
            if (!authenticated) throw new Error("password authentication failed");
          }
          return invoke(command, args);
        };
      });
      await page.goto(`http://localhost:${server.port}/compare`);
      await page.getByRole("button", { name: "Vergleich einrichten", exact: true }).click();
      const setup = page.getByRole("dialog", { name: "Vergleich einrichten", exact: true });
      const password = page.getByRole("dialog", { name: "Passwort erforderlich", exact: true });
      const selectTarget = async () => {
        await setup.getByText("Verbindung wählen", { exact: true }).click();
        await page.getByRole("option", { name: "Ziel ohne Passwort" }).click();
        await password.waitFor();
      };
      const targetCalls = () =>
        page.evaluate(() => (window as unknown as { targetCalls: unknown[] }).targetCalls);
      await selectTarget();
      expect(await targetCalls()).toEqual([]);
      await password.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await password.waitFor({ state: "hidden" });
      expect(await setup.isVisible()).toBe(true);
      expect(await setup.getByText("Verbindung wählen", { exact: true }).isVisible()).toBe(true);
      await selectTarget();
      await password.getByLabel("Passwort", { exact: true }).fill("test-password");
      await page.keyboard.press("Escape");
      await password.waitFor({ state: "hidden" });
      expect(await setup.isVisible()).toBe(true);
      expect(await targetCalls()).toEqual([]);
      await selectTarget();
      await password.getByLabel("Passwort", { exact: true }).fill("test-password");
      await password.getByRole("button", { name: "Verbinden", exact: true }).click();
      await password.waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        (window as unknown as { targetCalls: { command: string }[] }).targetCalls.some(
          (call) => call.command === "list_tables",
        ),
      );
      const calls = (await targetCalls()) as { command: string; authenticated: boolean }[];
      expect(calls.some((call) => call.command === "list_schemas")).toBe(true);
      expect(calls.every((call) => call.authenticated)).toBe(true);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.connections") ?? "null").state.activeId,
        ),
      ).toBe("perf");
    } finally {
      await saveBrowserArtifacts(browser, "compare-password");
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);
