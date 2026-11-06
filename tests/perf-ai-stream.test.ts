import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "streaming into a 400-message AI chat only re-renders the live answer",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/perf-ai-stream.tsx"],
      target: "browser",
      format: "esm",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "app-alias",
          setup(build) {
            build.onResolve({ filter: /^@\/router$/ }, ({ path }) => ({ path, external: true }));
            build.onResolve({ filter: /^@\// }, ({ path }) => ({
              path: Bun.resolveSync(resolve("src", path.slice(2)), import.meta.dir),
            }));
          },
        },
      ],
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const source = await bundle.outputs.find((output) => output.kind === "entry-point")?.text();
    const html = await Bun.file("dist/index.html").text();
    const stylesheet = html.match(/rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
    if (!stylesheet || !source) throw new Error("Missing production stylesheet or bundle");
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
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://localhost:${server.port}`);
      await page.locator('[data-from="assistant"]').first().waitFor();
      const messages = await page.evaluate(
        () => (window as unknown as { aiStreamMessages: number }).aiStreamMessages,
      );
      const deltas = 300;
      const durations = await page.evaluate(
        (count) =>
          (window as unknown as { aiStream: (count: number) => Promise<number[]> }).aiStream(count),
        deltas,
      );
      const sorted = durations.toSorted((left, right) => left - right);
      const medianMs = Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
      const p95Ms = Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2));
      const totalMs = Math.round(durations.reduce((sum, value) => sum + value, 0));
      const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
      expect(
        await page.locator('[data-from="assistant"][aria-busy="true"]').textContent(),
      ).toContain(`Wort ${deltas - 1}`);
      expect(await page.getByRole("button", { name: "Vorherige Version" }).count()).toBe(1);
      expect(errors).toEqual([]);
      await reportScenario(`ai-stream-${engine}`, {
        browser: browser.version(),
        messages,
        deltas,
        medianMs,
        p95Ms,
        totalMs,
        nodes,
      });
      expect(medianMs).toBeLessThan(8);
      expect(p95Ms).toBeLessThan(16);
      expect(nodes / messages).toBeLessThan(60);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120_000,
);
