import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import config from "../src-tauri/tauri.conf.json";

test.skipIf(!process.env.L8DB_EXTENSION_BROWSER)(
  "real sandbox: lifecycle, permissions, CSP, timeout and isolation",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/extension-browser.ts"],
      target: "browser",
      format: "esm",
      plugins: [
        {
          name: "raw-worker",
          setup(build) {
            build.onResolve({ filter: /\.js\?raw$/ }, (args) => ({
              path: resolve(args.resolveDir, args.path),
              namespace: "raw-worker",
            }));
            build.onLoad({ filter: /\.js\?raw$/, namespace: "raw-worker" }, async (args) => ({
              contents: `export default ${JSON.stringify(await readFile(args.path.replace(/\?raw$/, ""), "utf8"))}`,
              loader: "js",
            }));
          },
        },
      ],
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const source = await bundle.outputs[0].text();
    const csp = Object.entries(config.app.security.csp)
      .map(([key, value]) => `${key} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/test.js")
          return new Response(source, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/start.js")
          return new Response('import {run} from "/test.js"; window.result = run();', {
            headers: { "Content-Type": "text/javascript" },
          });
        return new Response(
          '<html><body><script src="/start.js" type="module"></script><script>window.untrustedInlineRan = true</script></body></html>',
          { headers: { "Content-Type": "text/html", "Content-Security-Policy": csp } },
        );
      },
    });
    const engine = process.env.L8DB_EXTENSION_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch(
      process.env.L8DB_EXTENSION_BROWSER === "chrome"
        ? { channel: "chrome", headless: true }
        : { headless: true },
    );
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${server.port}`);
      await page.waitForFunction(() => "result" in window);
      const result = await page.evaluate(
        () => (window as unknown as { result: Promise<Record<string, unknown>> }).result,
      );
      expect(await page.evaluate(() => "untrustedInlineRan" in window)).toBe(false);
      expect(result.command).toBe(true);
      expect(result.eventSeen).toBe(true);
      expect(result.disposed).toBe(true);
      expect(result.restarted).toBe(true);
      expect(result.security).toEqual({
        networkBlocked: true,
        databaseBlocked: true,
        storageBlocked: true,
        noWindow: true,
        noTauri: true,
        noProcess: true,
      });
      expect(result.timeout).toBe(true);
      expect(result.isolated).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.frames).toBe(0);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  30000,
);
