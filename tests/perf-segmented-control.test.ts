import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "50 segmented controls keep selection and keyboard movement within the interaction budget",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/perf-segmented-control.tsx"],
      target: "browser",
      format: "esm",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "app-alias",
          setup(build) {
            build.onResolve({ filter: /^@\// }, ({ path }) => ({
              path: Bun.resolveSync(resolve("src", path.slice(2)), import.meta.dir),
            }));
          },
        },
      ],
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const source = await bundle.outputs[0].text();
    const html = await Bun.file("dist/index.html").text();
    const stylesheet = html.match(/rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
    if (!stylesheet) throw new Error("Missing production stylesheet");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/perf.js")
          return new Response(source, { headers: { "Content-Type": "text/javascript" } });
        if (path.startsWith("/assets/"))
          return new Response(Bun.file(resolve("dist", path.slice(1))));
        return new Response(
          `<!doctype html><html><head><link rel="stylesheet" href="${stylesheet}"></head><body><div id="root"></div><script type="module" src="/perf.js"></script></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://localhost:${server.port}`);
      await page.getByRole("radiogroup").last().waitFor();
      if (engine === "chromium")
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", {
          rate: 4,
        });
      const control = page.getByRole("radiogroup", { name: "Control 0", exact: true });
      for (let index = 1; index <= 9; index++) {
        await control.getByText(`Option ${index}`, { exact: true }).click();
        await page.waitForFunction(
          (count) =>
            (window as unknown as { segmentDurations: number[] }).segmentDurations.length >= count,
          index,
        );
      }
      const durations = await page.evaluate(() =>
        (window as unknown as { segmentDurations: number[] }).segmentDurations.toSorted(
          (left, right) => left - right,
        ),
      );
      const medianMs = durations[4];
      const p95Ms = durations[8];
      expect(p95Ms).toBeLessThan(120);
      const selected = control.getByRole("radio", { checked: true });
      expect(await selected.getAttribute("value")).toBe("9");
      await selected.press("ArrowRight");
      expect(await control.getByRole("radio", { checked: true }).getAttribute("value")).toBe("0");
      await control.getByRole("radio", { checked: true }).press("End");
      expect(await control.getByRole("radio", { checked: true }).getAttribute("value")).toBe("9");
      const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
      expect(nodes).toBeLessThan(1600);
      expect(await page.getByRole("radio", { checked: true }).count()).toBe(50);
      expect(errors).toEqual([]);
      await reportScenario(`segmented-control-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        controls: 50,
        optionsPerControl: 10,
        medianMs,
        p95Ms,
        nodes,
      });
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
