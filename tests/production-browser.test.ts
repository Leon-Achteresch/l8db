import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PRODUCTION_BROWSER)(
  "built app loads its editor and workers under production CSP",
  async () => {
    const root = resolve("dist");
    const policy = Object.entries(config.app.security.csp)
      .map(([name, value]) => `${name} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(root, `.${pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(root, "index.html")), {
          headers: { "Content-Type": "text/html", "Content-Security-Policy": policy },
        });
      },
    });
    const engine = process.env.L8DB_PRODUCTION_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const workers: string[] = [];
      page.on("worker", (worker) => workers.push(worker.url()));
      await seedApp(page, 20);
      await page.addInitScript(() => {
        const violations: string[] = [];
        Object.assign(window, { productionViolations: violations });
        document.addEventListener("securitypolicyviolation", (event) =>
          violations.push(`${event.violatedDirective}: ${event.blockedURI}`),
        );
      });
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Ausführen", exact: true }).first().waitFor();
      await page.waitForFunction(() => document.fonts.status === "loaded");
      if (workers.length === 0) await page.waitForEvent("worker", { timeout: 10000 });
      expect(workers.length).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { productionViolations: string[] }).productionViolations,
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);
