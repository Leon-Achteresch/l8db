import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_MONACO_DIFF_BROWSER)(
  "Schema-Vergleich registriert den Monaco-Diff-Editor beim Öffnen",
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
    const browser = await (process.env.L8DB_MONACO_DIFF_BROWSER_ENGINE === "webkit"
      ? webkit
      : chromium
    ).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(page, 2, { rows: 2, columns: 2 }, "perf-test");
      await page.addInitScript(() => {
        localStorage.setItem(
          "l8db.schema-compare",
          JSON.stringify({
            state: {
              source: { connectionId: "perf", database: "l8db_perf", schema: "public" },
              target: { connectionId: "perf", database: "l8db_perf", schema: "schema_0" },
              types: ["view"],
              options: {
                ignoreWhitespace: true,
                ignoreCase: false,
                ignoreSystemNames: true,
                ignoreSequenceValues: true,
              },
            },
            version: 0,
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        host.__TAURI_INTERNALS__.invoke = (command, args) => {
          if (command === "schema_catalog")
            return Promise.resolve([
              {
                object_type: "view",
                name: "inventory",
                parent: null,
                ddl: args?.schema === "public" ? "SELECT 1 AS stock" : "SELECT 2 AS stock",
                attributes: {},
              },
            ]);
          return original(command, args);
        };
      });
      await page.goto(`http://localhost:${server.port}/schema-compare`);
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("textbox", { name: "Unterschiede filtern" }).fill("inventory");
      await page.getByRole("treeitem", { name: /inventory/ }).click();
      await page.locator(".monaco-diff-editor").waitFor();
      expect(await page.locator(".monaco-diff-editor .view-lines").count()).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
