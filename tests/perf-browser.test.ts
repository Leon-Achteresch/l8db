import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";

type PerfResult = {
  mountMs: number;
  renderedRows: number;
  renderedCells: number;
  rowsAfterScroll: number;
  fps: number;
  worstFrameMs: number;
  horizontalHeights: number[];
  horizontalFps: number;
  horizontalWorstFrameMs: number;
  heapMb: number;
  totalRows: number;
};

const WEBKIT = process.env.L8DB_PERF_ENGINE === "webkit";

const HOST_CSS =
  "html,body,#root{margin:0;height:100%}#root{display:flex;flex-direction:column;height:600px}";
const CSS =
  HOST_CSS +
  ".flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.basis-0{flex-basis:0}" +
  ".min-h-0{min-height:0}.overflow-auto{overflow:auto}.overflow-hidden{overflow:hidden}.relative{position:relative}" +
  ".h-full{height:100%}.border-spacing-0{border-spacing:0}.table-fixed{table-layout:fixed}.min-w-full{min-width:100%}" +
  ".truncate{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.sticky{position:sticky}.top-0{top:0}.left-0{left:0}";

for (const kind of ["table", "result"])
  for (const columns of [12, 49, 120]) {
    test.skipIf(!process.env.L8DB_PERF_BROWSER)(
      `${kind}: FPS, DOM-Größe und Mount-Zeit bei 5.000 × ${columns + 1} Zellen`,
      async () => {
        const bundle = await Bun.build({
          entrypoints: ["tests/fixtures/perf-browser.tsx"],
          plugins: [
            {
              name: "app-alias",
              setup(build) {
                build.onResolve({ filter: /^@\// }, ({ path }) => ({
                  path: Bun.resolveSync(
                    resolve(import.meta.dir, "../src", path.slice(2)),
                    import.meta.dir,
                  ),
                }));
              },
            },
          ],
          target: "browser",
          format: "esm",
          minify: true,
          define: {
            "process.env.NODE_ENV": '"production"',
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
          },
        });
        if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
        const source = await bundle.outputs[0].text();
        const stylesheet =
          process.env.L8DB_PERF_CSS ??
          (process.env.L8DB_PERF_STYLED
            ? `dist${(await Bun.file("dist/index.html").text()).match(/rel="stylesheet"[^>]+href="([^"]+)"/)![1]}`
            : undefined);
        const css = stylesheet ? (await Bun.file(stylesheet).text()) + HOST_CSS : CSS;
        const server = Bun.serve({
          port: 0,
          fetch: (request) => {
            const pathname = new URL(request.url).pathname;
            if (pathname.startsWith("/assets/"))
              return new Response(Bun.file(resolve("dist/assets", pathname.split("/").at(-1)!)));
            return pathname === "/perf.js"
              ? new Response(source, { headers: { "Content-Type": "text/javascript" } })
              : new Response(
                  `<!doctype html><html><head><base href="/assets/"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/perf.js"></script></body></html>`,
                  { headers: { "Content-Type": "text/html" } },
                );
          },
        });
        const browser = await (process.env.L8DB_PERF_ENGINE === "webkit"
          ? webkit
          : chromium
        ).launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`http://localhost:${server.port}?columns=${columns}&kind=${kind}`);
          await page.waitForFunction(() => "result" in window);
          const result = (await page.evaluate(
            () => (window as unknown as { result: Promise<PerfResult> }).result,
          )) as PerfResult;
          console.log(
            `perf ${kind}/${columns}: mount ${result.mountMs.toFixed(0)} ms, ${result.renderedRows}/${result.totalRows} rows, ${result.renderedCells} cells im DOM, ${result.fps.toFixed(1)} fps, worst frame ${result.worstFrameMs.toFixed(1)} ms, heap ${result.heapMb.toFixed(1)} MB, horizontal ${result.horizontalFps.toFixed(1)} fps, worst ${result.horizontalWorstFrameMs.toFixed(1)} ms`,
          );
          expect(errors).toEqual([]);
          expect(result.renderedRows).toBeGreaterThan(0);
          expect(result.renderedRows).toBeLessThan(80);
          expect(result.rowsAfterScroll).toBeGreaterThan(0);
          expect(result.rowsAfterScroll).toBeLessThan(80);
          expect(result.renderedCells).toBeLessThan(1200);
          expect(result.mountMs).toBeLessThan(3000);
          expect(result.fps).toBeGreaterThan(55);
          expect(result.worstFrameMs).toBeLessThan(60);
          expect(result.horizontalFps).toBeGreaterThan(WEBKIT ? 50 : 55);
          expect(result.horizontalWorstFrameMs).toBeLessThan(WEBKIT ? 80 : 60);
          if (stylesheet && kind === "table") expect(result.horizontalHeights).toEqual([33]);
          if (columns === 49) {
            const unchanged = await page.evaluate(async () => {
              const scroller = document.querySelector<HTMLElement>(".overflow-auto")!;
              const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
              scroller.scrollLeft = 650;
              await settle();
              const row = document.querySelector('tbody tr[data-index="0"]')!;
              const cells = [...row.children];
              const headers = [...document.querySelectorAll("thead th")];
              scroller.scrollLeft = 850;
              await settle();
              return {
                cells:
                  cells.length === row.children.length &&
                  cells.every((cell, index) => cell === row.children[index]),
                headers:
                  headers.length === document.querySelectorAll("thead th").length &&
                  headers.every(
                    (header, index) => header === document.querySelectorAll("thead th")[index],
                  ),
              };
            });
            expect(unchanged).toEqual({ cells: true, headers: true });
            if (kind === "table") {
              const header = page.locator("thead th").filter({
                has: page.getByRole("button", { name: "col_4 verschieben", exact: true }),
              });
              const width = await header.evaluate(
                (element) => element.getBoundingClientRect().width,
              );
              const resizeHandle = await header.locator(".cursor-col-resize").boundingBox();
              if (!resizeHandle) throw new Error("column resize handle not found");
              await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + 10);
              await page.mouse.down();
              await page.mouse.move(
                resizeHandle.x + resizeHandle.width / 2 + 60,
                resizeHandle.y + 10,
              );
              await page.mouse.up();
              await page.waitForFunction((expected) => {
                const cell = document.querySelector(
                  'tbody tr[data-index="0"] td[data-col="col_4"]',
                );
                return cell && Math.abs(cell.getBoundingClientRect().width - expected) < 2;
              }, width + 60);
              expect(
                await header.evaluate((element) => element.getBoundingClientRect().width),
              ).toBeCloseTo(width + 60, 0);
              await header.click({ button: "right" });
              await page
                .getByRole("menuitem", { name: "Aufsteigend sortieren", exact: true })
                .click();
              await header.locator(".lucide-arrow-up").waitFor();
              await header.click({ button: "right" });
              await page.getByRole("menuitem", { name: "Spalte ausblenden", exact: true }).click();
              await header.waitFor({ state: "detached" });
              expect(await page.locator('tbody td[data-col="col_4"]').count()).toBe(0);
            }
          }
          if (columns === 120) {
            await page
              .locator(".overflow-auto")
              .first()
              .evaluate((element) => {
                element.scrollLeft = element.scrollWidth;
                element.scrollTop = element.scrollHeight;
              });
            await page.waitForFunction(() =>
              document.querySelector('tbody tr[data-index="4999"] td[data-col="col_119"]'),
            );
            expect(await page.locator("tbody td:not([aria-hidden])").count()).toBeLessThan(1200);
            await page
              .locator(".overflow-auto")
              .first()
              .evaluate((element) => {
                element.scrollTop = 0;
              });
            await page.waitForFunction(() =>
              document.querySelector('tbody tr[data-index="0"] td[data-col="col_119"]'),
            );
            if (kind === "table") {
              await page
                .locator("thead th")
                .filter({ hasText: "col_119" })
                .click({ button: "right" });
              await page.getByRole("menuitem", { name: "Spalte links fixieren" }).click();
              await page
                .locator(".overflow-auto")
                .first()
                .evaluate((element) => {
                  element.scrollLeft = 0;
                });
              const cell = page.locator('tbody tr[data-index="0"] td[data-col="col_119"]');
              await cell.dblclick();
              const input = page.locator("tbody input");
              await input.fill("performance edit");
              await input.press("Enter");
              await page.waitForFunction(() => "saved" in window);
              expect(
                await page.evaluate(
                  () =>
                    (window as unknown as { saved: { updates: Record<string, string> } }).saved
                      .updates.col_119,
                ),
              ).toBe("performance edit");
              await page.waitForFunction(() => !document.querySelector("tbody input"));
              await cell.dblclick();
              await page.locator('tbody tr[data-index="1"] td[data-col="col_119"]').click();
              expect(await page.locator("tbody input").count()).toBe(0);
              const pinnedX = await cell.evaluate(
                (element) => element.getBoundingClientRect().left,
              );
              await page
                .locator(".overflow-auto")
                .first()
                .evaluate((element) => {
                  element.scrollLeft = 2000;
                });
              await page.waitForFunction(
                () => document.querySelector(".overflow-auto")!.scrollLeft >= 2000,
              );
              expect(
                Math.abs(
                  (await cell.evaluate((element) => element.getBoundingClientRect().left)) -
                    pinnedX,
                ),
              ).toBeLessThan(2);
            } else {
              await page
                .getByTitle("Lokal sortieren nach col_119 (Umschalt-Klick für mehrere Spalten)")
                .click();
              await page.getByRole("button", { name: "Filter", exact: true }).click();
              await page
                .getByRole("textbox", { name: "Filter für col_119", exact: true })
                .fill("__no_matching_value__");
              await page.waitForFunction(() =>
                document.body.textContent?.includes("0 von 5000 Zeilen"),
              );
              await page.getByRole("textbox", { name: "Filter für col_119", exact: true }).fill("");
              await page.waitForFunction(() => document.querySelector('tbody tr[data-index="0"]'));
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await browser.close();
          server.stop(true);
        }
      },
      60000,
    );
  }
