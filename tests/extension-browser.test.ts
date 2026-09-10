import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";

test.skipIf(!process.env.L8DB_EXTENSION_BROWSER)("real sandbox: lifecycle, permissions, CSP, timeout and isolation", async () => {
  const bundle = await Bun.build({
    entrypoints: ["tests/fixtures/extension-browser.ts"], target: "browser", format: "esm",
    plugins: [{ name: "raw-worker", setup(build) {
      build.onResolve({ filter: /worker-bootstrap\.js\?raw$/ }, () => ({ path: "worker-bootstrap", namespace: "raw-worker" }));
      build.onLoad({ filter: /.*/, namespace: "raw-worker" }, async () => ({ contents: `export default ${JSON.stringify(await readFile("src/lib/extensions/worker-bootstrap.js", "utf8"))}`, loader: "js" }));
    } }],
  });
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  const source = await bundle.outputs[0].text();
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/test.js" ? new Response(source, { headers: { "Content-Type": "text/javascript" } }) : new Response('<html><body><script type="module">import {run} from "/test.js"; window.result = run();</script></body></html>', { headers: { "Content-Type": "text/html" } }) });
  const engine = process.env.L8DB_EXTENSION_BROWSER === "webkit" ? webkit : chromium;
  const browser = await engine.launch(process.env.L8DB_EXTENSION_BROWSER === "chrome" ? { channel: "chrome", headless: true } : { headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}`);
    await page.waitForFunction(() => "result" in window);
    const result = await page.evaluate(() => (window as unknown as { result: Promise<Record<string, unknown>> }).result);
    expect(result.command).toBe(true);
    expect(result.eventSeen).toBe(true);
    expect(result.disposed).toBe(true);
    expect(result.restarted).toBe(true);
    expect(result.security).toEqual({ networkBlocked: true, databaseBlocked: true, storageBlocked: true, noWindow: true, noTauri: true, noProcess: true });
    expect(result.timeout).toBe(true);
    expect(result.isolated).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.frames).toBe(0);
  } finally { await browser.close(); server.stop(true) }
}, 30000);
