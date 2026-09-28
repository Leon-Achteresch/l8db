import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

for (const engine of [chromium, webkit]) {
  test.skipIf(!process.env.L8DB_PERF_APP)(
    `${engine.name()}: View-Daten laden die SQL-Vervollständigung erst beim Öffnen der Definition`,
    async () => {
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
          return new Response(
            pathname !== "/" && (await file.exists()) ? file : Bun.file("dist/index.html"),
          );
        },
      });
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await seedApp(page, 3000, { rows: 2000, columns: 60 });
        await page.goto(`http://localhost:${server.port}/`);
        await page.locator('a[data-name="table_0000"]').waitFor();
        await page.evaluate(() => {
          const scope = window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (
                command: string,
                args: Record<string, unknown> | undefined,
              ) => Promise<unknown>;
            };
            __metadataCalls: string[];
          };
          const original = scope.__TAURI_INTERNALS__.invoke;
          scope.__metadataCalls = [];
          scope.__TAURI_INTERNALS__.invoke = (command, args) => {
            if (command === "list_all_columns" || command === "get_view_definition")
              scope.__metadataCalls.push(command);
            return original(command, args);
          };
          history.pushState({}, "", "/view-editor/public/v_table_0000");
          dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.getByRole("tab", { name: "Definition" }).waitFor();
        await page.waitForTimeout(300);
        expect(
          await page.evaluate(
            () => (window as unknown as { __metadataCalls: string[] }).__metadataCalls,
          ),
        ).toEqual([]);
        await page.getByRole("tab", { name: "Definition" }).click();
        await page.locator('.monaco-editor[role="code"]').waitFor({ timeout: 30000 });
        await page.waitForFunction(() => {
          const calls = (window as unknown as { __metadataCalls: string[] }).__metadataCalls;
          return calls.includes("list_all_columns") && calls.includes("get_view_definition");
        });
        expect(await page.locator(".monaco-editor .view-lines").innerText()).toContain("SELECT");
        const firstCalls = await page.evaluate(
          () => (window as unknown as { __metadataCalls: string[] }).__metadataCalls,
        );
        await page.getByRole("tab", { name: "Daten" }).click();
        await page.getByRole("tab", { name: "Definition" }).click();
        await page.locator('.monaco-editor[role="code"]').waitFor();
        await page.waitForTimeout(300);
        expect(
          await page.evaluate(
            () => (window as unknown as { __metadataCalls: string[] }).__metadataCalls,
          ),
        ).toEqual(firstCalls);
        expect(
          errors.filter(
            (error) => error !== "ResizeObserver loop completed with undelivered notifications.",
          ),
        ).toEqual([]);
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    60000,
  );
}
