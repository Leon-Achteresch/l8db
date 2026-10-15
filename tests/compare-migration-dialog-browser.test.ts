import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const COLUMNS = 2000;
const body = Array.from({ length: COLUMNS }, (_, index) => `    o.col_${index},`);
const source = [" SELECT o.id,", ...body, "    o.created_at", "   FROM orders o;"].join("\n");
const target = [
  " SELECT o.id,",
  ...body.slice(0, COLUMNS / 2),
  "    o.inserted_col,",
  ...body.slice(COLUMNS / 2),
  "    o.created_at,",
  "    o.updated_at",
  "   FROM orders o;",
].join("\n");

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

test.skipIf(!process.env.L8DB_COMPARE_BROWSER)(
  "Migration erzeugen öffnet ein Modal und danach direkt den SQL-Editor",
  async () => {
    const root = resolve("dist");
    const shots = process.env.L8DB_SCREENSHOT_DIR;
    if (shots) mkdirSync(shots, { recursive: true });
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
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 2, { rows: 2, columns: 2 });
      await page.addInitScript(
        ([left, right]) => {
          const host = window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
            __definitionRequests: number;
            __executions: number;
          };
          host.__definitionRequests = 0;
          host.__executions = 0;
          const original = host.__TAURI_INTERNALS__.invoke;
          host.__TAURI_INTERNALS__.invoke = (command, args) => {
            if (command === "get_view_definition") {
              host.__definitionRequests += 1;
              return Promise.resolve(args?.view === "v_left" ? left : right);
            }
            if (command === "execute_query" || command === "execute_query_cancellable")
              host.__executions += 1;
            return original(command, args);
          };
          const side = (objectName: string) => ({
            connectionId: "perf",
            database: "l8db_perf",
            schema: "public",
            objectType: "view",
            objectName,
            objectOid: null,
          });
          localStorage.setItem(
            "l8db.table-tabs",
            JSON.stringify({
              version: 4,
              state: {
                tabsByConnection: {
                  perf: [
                    {
                      kind: "tool",
                      tool: "compare",
                      id: "first",
                      title: "Vergleich v_left",
                      compare: {
                        left: side("v_left"),
                        right: side("v_right"),
                        draft: null,
                        onlyDifferences: false,
                        showDraft: false,
                      },
                    },
                  ],
                },
              },
            }),
          );
        },
        [source, target],
      );
      await page.goto(`http://localhost:${server.port}/compare`);
      await page.getByRole("button", { name: "Vergleich v_left", exact: true }).click();
      await page.locator(".definition-diff-editor .editor.modified").waitFor();
      await page.getByText("Definitionen werden geladen…").waitFor({ state: "detached" });
      if (shots) await page.screenshot({ path: `${shots}/1-vergleich.png` });

      const trigger = page.getByRole("button", { name: "Migration erzeugen" });
      const dialog = page.getByRole("dialog", { name: "Migration erzeugen" });
      const editors = () => page.evaluate(() => document.querySelectorAll(".monaco-editor").length);
      const baseEditors = await editors();
      const loadedDefinitions = await page.evaluate(
        () => (window as unknown as { __definitionRequests: number }).__definitionRequests,
      );
      const timings: number[] = [];
      for (let round = 0; round < 7; round++) {
        const started = performance.now();
        await trigger.click();
        await dialog.locator(".view-lines").waitFor();
        timings.push(performance.now() - started);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
      }
      const median = percentile(timings, 0.5);
      const p95 = percentile(timings, 0.95);
      console.log(
        `migration dialog open (${COLUMNS} columns): median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`,
      );
      expect(median).toBeLessThan(600);
      expect(p95).toBeLessThan(1200);
      expect(await editors()).toBe(baseEditors);

      await trigger.click();
      await dialog.locator(".view-lines").waitFor();
      const forTarget = dialog.getByRole("button", { name: /Für Ziel/ });
      expect(await forTarget.getAttribute("aria-pressed")).toBe("true");
      const preview = (await dialog.locator(".view-lines").textContent()) ?? "";
      expect(preview.replace(/\u00a0/g, " ")).toContain(
        'CREATE OR REPLACE VIEW "public"."v_right"',
      );
      if (shots) await page.screenshot({ path: `${shots}/2-migration-modal.png` });

      await dialog.getByRole("button", { name: "Im SQL-Editor öffnen" }).click();
      await page.waitForURL(/\/query\//);
      await dialog.waitFor({ state: "detached" });
      await page
        .locator(".monaco-editor .view-lines", { hasText: /CREATE\sOR\sREPLACE\sVIEW/ })
        .first()
        .waitFor();
      if (shots) await page.screenshot({ path: `${shots}/3-sql-editor.png` });

      const counters = await page.evaluate(() => {
        const host = window as unknown as { __definitionRequests: number; __executions: number };
        return { definitions: host.__definitionRequests, executions: host.__executions };
      });
      expect(counters.definitions).toBe(loadedDefinitions);
      expect(counters.executions).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
