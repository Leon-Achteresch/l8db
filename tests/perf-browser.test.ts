import { expect, test } from "bun:test";
import { chromium } from "playwright";

type PerfResult = {
  mountMs: number;
  renderedRows: number;
  rowsAfterScroll: number;
  fps: number;
  worstFrameMs: number;
  heapMb: number;
  totalRows: number;
};

const CSS =
  "html,body,#root{margin:0;height:100%}#root{display:flex;flex-direction:column;height:600px}" +
  ".flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.basis-0{flex-basis:0}" +
  ".min-h-0{min-height:0}.overflow-auto{overflow:auto}.overflow-hidden{overflow:hidden}.relative{position:relative}" +
  ".truncate{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.sticky{position:sticky}.top-0{top:0}";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "Datentabelle: FPS, DOM-Größe und Mount-Zeit bei 5.000 Zeilen",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/perf-browser.tsx"],
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
        new URL(request.url).pathname === "/perf.js"
          ? new Response(source, { headers: { "Content-Type": "text/javascript" } })
          : new Response(
              `<!doctype html><html><head><style>${CSS}</style></head><body><div id="root"></div><script type="module" src="/perf.js"></script></body></html>`,
              { headers: { "Content-Type": "text/html" } },
            ),
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://localhost:${server.port}`);
      await page.waitForFunction(() => "result" in window);
      const result = (await page.evaluate(
        () => (window as unknown as { result: Promise<PerfResult> }).result,
      )) as PerfResult;
      console.log(
        `perf: mount ${result.mountMs.toFixed(0)} ms, ${result.renderedRows}/${result.totalRows} rows im DOM, ${result.fps.toFixed(1)} fps, worst frame ${result.worstFrameMs.toFixed(1)} ms, heap ${result.heapMb.toFixed(1)} MB`,
      );
      expect(errors).toEqual([]);
      expect(result.renderedRows).toBeLessThan(80);
      expect(result.rowsAfterScroll).toBeLessThan(80);
      expect(result.mountMs).toBeLessThan(3000);
      expect(result.fps).toBeGreaterThan(30);
      expect(result.worstFrameMs).toBeLessThan(250);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
