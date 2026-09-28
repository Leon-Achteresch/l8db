import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

for (const engine of [chromium, webkit]) {
  test.skipIf(!process.env.L8DB_PERF_APP)(
    `${engine.name()}: Tabellenzeilen bleiben bei Dichte und Skalierung lückenlos`,
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
        for (const { scale, density } of [
          { scale: 80, density: "compact" },
          { scale: 100, density: "normal" },
          { scale: 150, density: "spacious" },
        ]) {
          const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await seedApp(page, 100, { rows: 1000, columns: 60 });
          await page.addInitScript(
            ({ scale, density }) => {
              const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
              localStorage.setItem(
                "l8db.settings",
                JSON.stringify({
                  ...saved,
                  state: { ...saved.state, uiScale: scale, uiDensity: density, rowLimit: 1000 },
                }),
              );
            },
            { scale, density },
          );
          await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
          const first = page.locator('tbody tr[data-index="0"]');
          await first.waitFor();
          const expected =
            ((density === "compact" ? 24 : density === "spacious" ? 40 : 32) * scale) / 100 + 1;
          const height = (await first.boundingBox())?.height ?? 0;
          expect(Math.abs(height - expected)).toBeLessThan(1);
          if (density === "normal") {
            await first.locator('td[data-col="col_1"]').dblclick();
            await page.locator("tbody input, tbody select").first().waitFor();
            expect((await first.boundingBox())?.height ?? 0).toBeGreaterThan(height + 10);
            await page.keyboard.press("Escape");
            await page.locator("tbody input, tbody select").first().waitFor({ state: "hidden" });
          }
          for (const fraction of [0.25, 0.5, 1]) {
            await page.locator("tbody").evaluate((element, value) => {
              let scroller = element.parentElement;
              while (scroller && getComputedStyle(scroller).overflowY !== "auto")
                scroller = scroller.parentElement;
              if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
              scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * value;
            }, fraction);
            await page.waitForTimeout(100);
            const coverage = await page.evaluate(() => {
              let scroller = document.querySelector("tbody")?.parentElement ?? null;
              while (scroller && getComputedStyle(scroller).overflowY !== "auto")
                scroller = scroller.parentElement;
              if (!scroller) return false;
              const box = scroller.getBoundingClientRect();
              return [box.top + box.height * 0.4, box.top + box.height * 0.8].every((y) => {
                const cell = document
                  .elementFromPoint(box.left + box.width * 0.5, y)
                  ?.closest("td");
                return Boolean(
                  cell?.closest("tr[data-index]") && !cell.hasAttribute("aria-hidden"),
                );
              });
            });
            expect(coverage).toBe(true);
          }
          await page.locator('tbody tr[data-index="999"]').waitFor();
          expect(
            errors.filter(
              (error) => error !== "ResizeObserver loop completed with undelivered notifications.",
            ),
          ).toEqual([]);
          await page.close();
        }
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    60000,
  );
}
