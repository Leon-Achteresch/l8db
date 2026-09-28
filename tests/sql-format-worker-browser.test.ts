import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_SQL_FORMAT_BROWSER)(
  "SQL-Formatierung lädt den Formatter erst beim Aufruf in einem Worker",
  async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file("dist/index.html"), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const browser = await (process.env.L8DB_SQL_FORMAT_BROWSER_ENGINE === "webkit"
      ? webkit
      : chromium
    ).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const requests: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(page, 2, { rows: 2, columns: 2 }, "perf-test");
      await page.goto(`http://localhost:${server.port}/query`);
      const editor = page.locator(".monaco-editor").first();
      await editor.waitFor();
      expect(requests.some((url) => url.includes("sql-format-worker"))).toBe(false);
      await editor.locator(".view-lines").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("select id from users");
      await page.keyboard.press("Alt+Shift+f");
      await page.waitForFunction(() =>
        document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("SELECT"),
      );
      expect(requests.some((url) => url.includes("sql-format-worker"))).toBe(true);
      expect(errors).toEqual([]);

      const settingsPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const settingsRequests: string[] = [];
      settingsPage.on("request", (request) => settingsRequests.push(request.url()));
      await settingsPage.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(settingsPage, 2, { rows: 2, columns: 2 }, "perf-test");
      await settingsPage.goto(`http://localhost:${server.port}/settings`);
      const settingsNav = settingsPage.getByRole("navigation", { name: "Einstellungskategorien" });
      await settingsNav.waitFor();
      expect(settingsRequests.some((url) => url.includes("sql-format-worker"))).toBe(false);
      await settingsNav.getByRole("button", { name: /SQL-Editor/ }).click();
      await settingsPage.waitForFunction(() =>
        [...document.querySelectorAll("span")]
          .find((element) => element.textContent === "SQL-Editor Vorschau")
          ?.parentElement?.parentElement?.textContent?.includes("SELECT"),
      );
      expect(settingsRequests.some((url) => url.includes("sql-format-worker"))).toBe(true);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
