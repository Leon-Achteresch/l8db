import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const body = Array.from({ length: 14 }, (_, index) => `    col_${index},`);
const source = [" SELECT o.id,", ...body, "    o.created_at", "   FROM orders o;"].join("\r\n");
const target = [
  " SELECT o.id,",
  ...body.slice(0, 7),
  "    o.inserted_col,",
  ...body.slice(7),
  "    o.created_at,",
  "    o.updated_at",
  "   FROM orders o;",
].join("\n");

async function readRows(page: import("playwright").Page, side: "original" | "modified") {
  return page.evaluate((which) => {
    const editor = document.querySelector(`.definition-diff-editor .editor.${which}`);
    if (!editor) return [];
    const marks = (cls: string) =>
      new Set(
        [...editor.querySelectorAll(`.view-overlays .${cls}`)].map((node) =>
          Math.round(node.getBoundingClientRect().top),
        ),
      );
    const red = marks("line-delete");
    const green = marks("line-insert");
    return [...editor.querySelectorAll(".view-lines .view-line")]
      .map((line) => {
        const top = Math.round(line.getBoundingClientRect().top);
        return {
          top,
          kind: red.has(top) ? "red" : green.has(top) ? "green" : "plain",
          text: (line.textContent ?? "").replace(/ /g, " ").trimEnd(),
        };
      })
      .sort((a, b) => a.top - b.top)
      .map(({ kind, text }) => `${kind} ${text.trim()}`);
  }, side);
}

test.skipIf(!process.env.L8DB_COMPARE_BROWSER)(
  "Definitionsvergleich färbt nur die Quelle rot und nur das Ziel grün und klappt Unverändertes ein",
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
          };
          const original = host.__TAURI_INTERNALS__.invoke;
          host.__TAURI_INTERNALS__.invoke = (command, args) => {
            if (command === "get_view_definition")
              return Promise.resolve(args?.view === "v_left" ? left : right);
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
      const header = page.locator("span.truncate.text-xs").first();
      const waitForHeader = async () => {
        await page.waitForFunction(
          () =>
            /Änderungen/.test(
              document.querySelector("span.truncate.text-xs")?.textContent ?? "",
            ),
          undefined,
          { timeout: 15000 },
        );
        expect(await header.textContent()).toBe("2 Änderungen · Quelle +1 · Ziel +3");
      };
      await page.locator(".definition-diff-editor .editor.modified").waitFor();
      await waitForHeader();

      const left = await readRows(page, "original");
      const right = await readRows(page, "modified");
      expect(left.filter((row) => row.startsWith("red "))).toEqual(["red o.created_at"]);
      expect(left.filter((row) => row.startsWith("green "))).toEqual([]);
      expect(right.filter((row) => row.startsWith("green "))).toEqual([
        "green o.inserted_col,",
        "green o.created_at,",
        "green o.updated_at",
      ]);
      expect(right.filter((row) => row.startsWith("red "))).toEqual([]);

      const hidden = page.locator(".definition-diff-editor .diff-hidden-lines");
      const col5 = page.locator(".definition-diff-editor .editor.original .view-line", {
        hasText: "col_5,",
      });
      await page.getByRole("button", { name: "Vergleichsoptionen" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Nur Unterschiede" }).click();
      await hidden.first().waitFor();
      expect(await col5.count()).toBe(0);
      await page.getByRole("button", { name: "Vergleichsoptionen" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Nur Unterschiede" }).click();
      await hidden.first().waitFor({ state: "detached" });
      expect(await col5.count()).toBe(1);

      await page.getByRole("button", { name: "Vergleichsoptionen" }).click();
      await page.getByRole("menuitem", { name: "Neu laden" }).click();
      await waitForHeader();
      expect(await readRows(page, "original")).toEqual(left);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
