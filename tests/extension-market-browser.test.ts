import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";
import { bundleFixture } from "./fixtures/browser-bundle";

test.skipIf(!process.env.L8DB_EXTENSION_BROWSER)(
  "Markt installiert und aktiviert Jev im echten Extension-Sandbox-Flow",
  async () => {
    const packageBytes = await readFile("extention/l8db.jev-1.1.0.l8db-extension");
    const catalog = JSON.stringify({
      schemaVersion: 1,
      extensions: [
        {
          id: "l8db.jev",
          name: "Jev Plan-Diagnose",
          description: "Optionale BYOK-Diagnose",
          version: "1.1.0",
          publisher: "l8db",
          package: "packages/l8db.jev-1.1.0.l8db-extension",
          sha256: createHash("sha256").update(packageBytes).digest("hex"),
        },
      ],
    });
    const output = await bundleFixture("tests/fixtures/extension-market-browser.tsx");
    const csp = Object.entries(config.app.security.csp)
      .map(([key, value]) => `${key} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/test.js")
          return new Response(output, {
            headers: { "Content-Type": "text/javascript" },
          });
        return new Response('<div id="root"></div><script type="module" src="/test.js"></script>', {
          headers: { "Content-Type": "text/html", "Content-Security-Policy": csp },
        });
      },
    });
    const browser = await (process.env.L8DB_EXTENSION_BROWSER === "webkit"
      ? webkit
      : chromium
    ).launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        "https://raw.githubusercontent.com/Leon-Achteresch/l8db-extension-market/main/**",
        (route) => {
          const body = route.request().url().endsWith("catalog.json") ? catalog : packageBytes;
          return route.fulfill({
            status: 200,
            body,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        },
      );
      await page.goto(`http://localhost:${server.port}`);
      const market = page.getByRole("region", { name: "Entdecken" });
      await market.getByText("Jev Plan-Diagnose").waitFor();
      await market.getByRole("button", { name: "Installieren" }).click();
      await market.getByRole("button", { name: "Installiert" }).waitFor();
      const community = page.getByRole("region", { name: "Installiert" });
      await community.getByRole("button", { name: "Aktivieren", exact: true }).click();
      await community.getByRole("checkbox", { name: /network/ }).check();
      await community.getByRole("checkbox", { name: /filesystem:extension-storage/ }).check();
      await community.getByRole("button", { name: "Erlauben und aktivieren" }).click();
      await page.getByRole("button", { name: "Mit Jev prüfen" }).last().click();
      await page.getByRole("dialog").getByRole("textbox").fill("test-byok-key");
      await page.getByRole("dialog").getByRole("button", { name: "Übernehmen" }).click();
      await page.getByRole("dialog").getByText("sequential_scan").waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "An TypeSafe senden" }).click();
      await page.waitForFunction(
        () =>
          (window as unknown as { marketState: { results: unknown[] } }).marketState.results
            .length === 1,
      );
      const state = await page.evaluate(() => {
        const market = (
          window as unknown as {
            marketState: {
              installed: Map<string, unknown>;
              requests: { body: string }[];
              results: { message: string }[];
            };
          }
        ).marketState;
        return {
          installedCount: market.installed.size,
          requests: market.requests,
          results: market.results,
        };
      });
      expect(state.installedCount).toBe(1);
      expect(state.requests).toHaveLength(1);
      expect(state.results[0].message).toContain("Breiter Tabellenscan");
      expect(state.requests[0].body).not.toContain("secret_customers");
      expect(state.requests[0].body).not.toContain("private@example.com");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
