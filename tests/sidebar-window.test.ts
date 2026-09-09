import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";

const COUNT = 3000;
const PITCH = 32.5;
const VIEWPORT = 600;

test.skipIf(!process.env.L8DB_SIDEBAR_BROWSER)(
  "sidebar: schnelles Scrollen durch 3000 Tabellen bleibt fehlerfrei und deckt den Sichtbereich",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/sidebar-window.tsx"],
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
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/sidebar.js"
          ? new Response(source, { headers: { "Content-Type": "text/javascript" } })
          : new Response(
              `<!doctype html><html><head><style>html,body{margin:0}ul{margin:0;padding:0;list-style:none}</style></head><body><div id="root"></div><script type="module" src="/sidebar.js"></script></body></html>`,
              { headers: { "Content-Type": "text/html" } },
            ),
    });
    const browser = await (process.env.L8DB_SIDEBAR_ENGINE === "webkit" ? webkit : chromium).launch(
      { headless: true },
    );
    try {
      const page = await browser.newPage({
        viewport: { width: 400, height: 700 },
        deviceScaleFactor: 2,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://localhost:${server.port}`);
      await page.locator("[data-index='0']").waitFor();

      const result = await page.evaluate(async () => {
        const scroller = document.querySelector<HTMLElement>("[data-slot=sidebar-content]")!;
        const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
        let maxItems = 0;
        const sample = setInterval(() => {
          maxItems = Math.max(maxItems, scroller.querySelectorAll("li").length);
        }, 16);
        for (let step = 0; step < 8; step++) {
          scroller.scrollTo({ top: step % 2 ? 0 : scroller.scrollHeight, behavior: "smooth" });
          await settle(400);
        }
        clearInterval(sample);
        await settle(400);
        scroller.scrollTo({ top: 1800, behavior: "instant" });
        await settle(400);
        const indices = [...scroller.querySelectorAll<HTMLElement>("[data-index]")].map((node) =>
          Number(node.dataset.index),
        );
        return {
          maxItems,
          first: indices[0]!,
          last: indices.at(-1)!,
          rendered: indices.length,
          height: scroller.scrollHeight,
          scrollTop: scroller.scrollTop,
        };
      });

      expect(errors).toEqual([]);
      expect(result.height).toBeGreaterThan(COUNT * PITCH * 0.95);
      expect(result.maxItems).toBeLessThan(4 * (VIEWPORT / PITCH));
      expect(result.rendered).toBe(result.last - result.first + 1);
      expect(result.first * PITCH).toBeLessThanOrEqual(result.scrollTop);
      expect((result.last + 1) * PITCH).toBeGreaterThanOrEqual(result.scrollTop + VIEWPORT);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
