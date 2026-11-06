import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_MULTI_TARGET_BROWSER)(
  "Mehrere Ziele fragen fehlende Passwörter nacheinander ab und lassen sich abbrechen",
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
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 2, { rows: 2, columns: 2 }, "pw", 0);
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "null");
        const servers = ["a", "b", "c"];
        for (const server of servers)
          stored.state.connections.push({
            ...stored.state.connections[0],
            id: `srv-${server}`,
            name: `Server ${server.toUpperCase()}`,
            connectionString: `postgresql://leon@${server}.test:5432/l8db_perf`,
          });
        localStorage.setItem("l8db.connections", JSON.stringify(stored));
        localStorage.setItem(
          "l8db.multi-target-groups",
          JSON.stringify({
            version: 1,
            state: {
              groups: [
                {
                  id: "group",
                  name: "Drei Server",
                  updatedAt: 1,
                  targets: servers.map((server) => ({
                    connectionId: `srv-${server}`,
                    database: "l8db_perf",
                    schema: null,
                  })),
                },
              ],
            },
          }),
        );
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                perf: [{ kind: "query", id: "mt", title: "Mehrere", sql: "SELECT 1 AS n" }],
              },
            },
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          targetCalls: { command: string; host: string; password: string }[];
        };
        const invoke = host.__TAURI_INTERNALS__.invoke;
        host.targetCalls = [];
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          const raw = String(args?.connectionString ?? "");
          if (raw.includes(".test:")) {
            const url = new URL(raw);
            host.targetCalls.push({ command, host: url.hostname, password: url.password });
            if (url.password !== `pw-${url.hostname[0]}`)
              throw new Error("password authentication failed");
            if (command === "execute_query")
              return {
                columns: ["n"],
                rows: [{ n: 1 }],
                rows_affected: null,
                execution_time_ms: 1,
              };
          }
          return invoke(command, args);
        };
      });
      await page.goto(`http://localhost:${server.port}/query/mt`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page.getByRole("button", { name: "Mehrere Ziele" }).click();
      const sheet = page.getByRole("dialog", { name: "Abfrage auf mehreren Zielen" });
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "Gruppen", exact: true }).click();
      await page.getByRole("menuitem", { name: /Drei Server/ }).click();
      await sheet.getByText("3 Ziele ausgewählt", { exact: true }).waitFor();

      const prompt = page.getByRole("dialog", { name: "Passwort erforderlich", exact: true });
      const field = prompt.getByLabel("Passwort", { exact: true });
      const promptFor = async (name: string) => {
        await prompt.getByText(`Für „${name}“ ist kein Passwort hinterlegt.`).waitFor();
        expect(await field.inputValue()).toBe("");
        expect(await field.evaluate((element) => element === document.activeElement)).toBe(true);
      };
      const calls = () =>
        page.evaluate(
          () =>
            (window as unknown as { targetCalls: { command: string; host: string }[] }).targetCalls,
        );

      await sheet.getByRole("button", { name: "Auf 3 Zielen ausführen" }).click();
      await promptFor("Server A");
      await field.fill("pw-a");
      await prompt.getByRole("button", { name: "Verbinden", exact: true }).click();
      await promptFor("Server B");
      await prompt.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await promptFor("Server C");
      await field.fill("pw-c");
      await field.press("Enter");
      await prompt.waitFor({ state: "hidden" });
      await sheet.getByText(/^3 von 3 fertig, 1 Fehler/).waitFor();
      await sheet.getByText("Ohne Passwort kann nicht verbunden werden.").first().waitFor();
      expect(await sheet.getByRole("button", { name: "Alle abbrechen" }).count()).toBe(0);
      expect(
        (await calls())
          .filter((call) => call.command === "execute_query")
          .map((call) => call.host)
          .sort(),
      ).toEqual(["a.test", "c.test"]);

      await sheet.getByRole("button", { name: "Auf 3 Zielen ausführen" }).click();
      await promptFor("Server B");
      await page.keyboard.press("Escape");
      await prompt.waitFor({ state: "hidden" });
      expect(await sheet.isVisible()).toBe(true);
      await sheet.getByText(/^3 von 3 fertig, 1 Fehler/).waitFor();
      expect(await sheet.getByRole("button", { name: "Alle abbrechen" }).count()).toBe(0);
      expect((await calls()).some((call) => call.host === "b.test")).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await saveBrowserArtifacts(browser, "multi-target-password");
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
