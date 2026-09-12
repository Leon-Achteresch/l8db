import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { profileWebKit } from "./fixtures/perf-webkit-profile";

type Sample = {
  fps: number;
  p95: number;
  p99: number;
  worst: number;
  overBudgetPercent: number;
  frames: number;
};

type PerfResult = {
  vertical: Sample;
  horizontal: Sample;
  diagonal: Sample;
  mountMs: number;
  renderedRows: number;
  renderedCells: number;
  rowsAfterScroll: number;
  fps: number;
  worstFrameMs: number;
  horizontalHeights: number[];
  horizontalFps: number;
  horizontalWorstFrameMs: number;
  heapMb: number | null;
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

const ROWS = Number(process.env.L8DB_PERF_ROWS ?? 5000);
const DURATION = Number(process.env.L8DB_PERF_DURATION ?? 2000);
const TEXT_SIZE = Number(process.env.L8DB_PERF_TEXT_SIZE ?? 0);
const SCALE = Number(process.env.L8DB_PERF_SCALE ?? 100);
const DENSITY = process.env.L8DB_PERF_DENSITY ?? "normal";
const STEP = Number(process.env.L8DB_PERF_STEP ?? 120);
const FK = process.env.L8DB_PERF_FK === "1";

for (const kind of ["table", "result"])
  for (const columns of [12, 49, 120]) {
    test.skipIf(!process.env.L8DB_PERF_BROWSER)(
      `${kind}: FPS, DOM-Größe und Mount-Zeit bei ${ROWS} × ${columns + 1} Zellen`,
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
          const profiler =
            process.env.L8DB_PERF_PROFILE && !WEBKIT
              ? await page.context().newCDPSession(page)
              : null;
          if (profiler) {
            await profiler.send("Profiler.enable");
            await profiler.send("Profiler.start");
          }
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(
            `http://localhost:${server.port}?columns=${columns}&kind=${kind}&rows=${ROWS}&duration=${DURATION}&textSize=${TEXT_SIZE}&scale=${SCALE}&density=${DENSITY}&step=${STEP}&fk=${FK ? 1 : 0}`,
          );
          const stopWebKitProfile =
            process.env.L8DB_PERF_PROFILE && WEBKIT
              ? await profileWebKit(page, `/tmp/l8db-perf-${kind}-${columns}.webkit-profile.json`)
              : null;
          await page.waitForFunction(() => "result" in window);
          const result = (await page.evaluate(
            () => (window as unknown as { result: Promise<PerfResult> }).result,
          )) as PerfResult;
          await stopWebKitProfile?.();
          if (profiler) {
            const profile = await profiler.send("Profiler.stop");
            await Bun.write(
              `/tmp/l8db-perf-${kind}-${columns}.cpuprofile`,
              JSON.stringify(profile.profile),
            );
          }
          console.log(
            `perf ${kind}/${columns}: mount ${result.mountMs.toFixed(0)} ms, ${result.renderedRows}/${result.totalRows} rows, ${result.renderedCells} cells im DOM, ${result.fps.toFixed(1)} fps, worst frame ${result.worstFrameMs.toFixed(1)} ms, heap ${result.heapMb === null ? "n/a" : `${result.heapMb.toFixed(1)} MB`}, horizontal ${result.horizontalFps.toFixed(1)} fps, worst ${result.horizontalWorstFrameMs.toFixed(1)} ms`,
          );
          for (const axis of ["vertical", "horizontal", "diagonal"] as const)
            console.log(`${kind}/${columns} ${axis}: ${JSON.stringify(result[axis])}`);
          if (process.env.L8DB_PERF_REPORT_DIR) {
            const name = `${WEBKIT ? "webkit" : "chromium"}-${kind}-${ROWS}-${columns}-${TEXT_SIZE}-${SCALE}-${DENSITY}-${FK ? "fk" : "plain"}`;
            await Bun.write(
              resolve(process.env.L8DB_PERF_REPORT_DIR, `${name}.json`),
              JSON.stringify(
                {
                  browser: browser.version(),
                  engine: WEBKIT ? "webkit" : "chromium",
                  sourceHash: Bun.hash(source).toString(16),
                  styleHash: Bun.hash(css).toString(16),
                  foreignKeys: FK,
                  rows: ROWS,
                  columns: columns + 1,
                  duration: DURATION,
                  textSize: TEXT_SIZE,
                  scale: SCALE,
                  density: DENSITY,
                  step: STEP,
                  ...result,
                },
                null,
                2,
              ),
            );
            await page.screenshot({
              path: resolve(process.env.L8DB_PERF_REPORT_DIR, `${name}.png`),
            });
          }
          expect(errors).toEqual([]);
          expect(result.renderedRows).toBeGreaterThan(0);
          expect(result.renderedRows).toBeLessThan(80);
          expect(result.rowsAfterScroll).toBeGreaterThan(0);
          expect(result.rowsAfterScroll).toBeLessThan(80);
          expect(result.renderedCells).toBeLessThan(1200);
          expect(result.mountMs).toBeLessThan(3000);
          for (const axis of ["vertical", "horizontal", "diagonal"] as const) {
            expect(result[axis].fps).toBeGreaterThan(59);
            expect(result[axis].p95).toBeLessThan(21);
            expect(result[axis].worst).toBeLessThan(50);
            expect(result[axis].frames).toBeGreaterThan((DURATION / 1000) * 55);
          }
          if (stylesheet && kind === "table") {
            const height =
              ((DENSITY === "compact" ? 24 : DENSITY === "spacious" ? 40 : 32) * SCALE) / 100 + 1;
            expect(result.horizontalHeights).toEqual([height]);
          }
          const scrollBox = await page.locator(".overflow-auto").first().boundingBox();
          if (!scrollBox) throw new Error("scroll container has no bounds");
          await page.mouse.move(
            scrollBox.x + scrollBox.width / 2,
            scrollBox.y + scrollBox.height / 2,
          );
          for (let turn = 0; turn < 16; turn++) {
            const direction = turn % 8 < 4 ? 1 : -1;
            await page.mouse.wheel(240 * direction, 240 * direction);
            await page.waitForTimeout(32);
            const coverage = await page.evaluate(() => {
              const scroller = document.querySelector(".overflow-auto")!;
              const box = scroller.getBoundingClientRect();
              const header = document.querySelector("thead")!.getBoundingClientRect();
              return [header.bottom + 10, box.bottom - 20].every((y) => {
                const cell = document.elementFromPoint(box.left + 80, y)?.closest("td");
                return !!cell?.closest("tr[data-index]") && !cell.hasAttribute("aria-hidden");
              });
            });
            expect(coverage).toBe(true);
          }
          await page
            .locator(".overflow-auto")
            .first()
            .evaluate((element) => {
              element.scrollTop = 0;
              element.scrollLeft = 0;
            });
          await page.waitForFunction(() => document.querySelector('tbody tr[data-index="0"]'));
          if (FK && kind === "table") {
            const cell = page.locator('tbody tr[data-index="1"] td[data-col="id"]');
            await cell
              .locator('[data-slot="hover-card-trigger"]')
              .click({ modifiers: ["ControlOrMeta"] });
            expect(
              await page.evaluate(() => (window as unknown as { navigated: unknown }).navigated),
            ).toEqual({ schema: "public", table: "parents", filter: '"id" = 1' });
          }
          if (TEXT_SIZE > 0) {
            const cell = page.locator('tbody tr[data-index="0"] td[data-col="col_0"]');
            expect((await cell.textContent())!.length).toBeLessThanOrEqual(
              kind === "table" ? 501 : 201,
            );
            if (kind === "table") {
              await cell.dblclick();
              expect((await page.locator("tbody input").inputValue()).length).toBe(TEXT_SIZE);
              await page.locator("tbody input").press("Escape");
              await cell.click();
              await page.getByTitle("Anzeigen / bearbeiten", { exact: true }).click();
              await page.getByRole("dialog").waitFor();
              expect(await page.getByRole("dialog").locator("pre").textContent()).toBe(
                "x".repeat(TEXT_SIZE),
              );
              await page.keyboard.press("Escape");
            } else {
              await cell.getByRole("button").click();
              expect(
                await page.evaluate(
                  () =>
                    (window as unknown as { inspected: { value: string } }).inspected.value.length,
                ),
              ).toBe(TEXT_SIZE);
              expect((await cell.getAttribute("title"))!.length).toBeLessThanOrEqual(201);
            }
          }
          if (columns === 49) {
            const unchanged = await page.evaluate(async () => {
              const scroller = document.querySelector<HTMLElement>(".overflow-auto")!;
              const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
              scroller.scrollLeft = 650;
              await settle();
              const row = document.querySelector('tbody tr[data-index="0"]')!;
              const cells = [...row.children];
              const headers = [...document.querySelectorAll("thead th")];
              scroller.scrollLeft = 680;
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
            await page.waitForFunction(
              (last) =>
                document.querySelector(`tbody tr[data-index="${last}"] td[data-col="col_119"]`),
              ROWS - 1,
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
              await page.waitForFunction(() => document.body.textContent?.includes("0 von "));
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
      Math.max(60000, DURATION * 3 + 30000),
    );
  }
