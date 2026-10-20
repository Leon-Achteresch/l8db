import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "team setup assistant switches steps within budget, bounds its DOM and stops idle videos",
  async () => {
    const dist = resolve(process.env.L8DB_PERF_DIST ?? "dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const file = Bun.file(resolve(dist, path.slice(1)));
        return new Response(
          path !== "/" && (await file.exists()) ? file : Bun.file(resolve(dist, "index.html")),
        );
      },
    });
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const media: string[] = [];
      page.on("request", (request) => {
        if (/\.(mp4|webm)(\?|$)|youtube|microsoft\.com|office\.net/.test(request.url()))
          media.push(request.url());
      });
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        internals.invoke = async (command, args) =>
          command === "team_microsoft_available" ? true : invoke(command, args);
      });
      await page.goto(`http://localhost:${server.port}/team-setup`);
      await page
        .getByRole("heading", { name: "Team-Verbindungen mit Microsoft 365 einrichten" })
        .waitFor();
      await page.waitForSelector('[data-team-setup-video="playing"]');

      const metrics = await page.evaluate(async () => {
        const buttons = [
          ...document.querySelectorAll<HTMLButtonElement>(
            'nav[aria-label="Einrichtungsschritte"] button',
          ),
        ];
        const heading = () => document.getElementById("team-setup-step")?.textContent;
        const main = document.getElementById("team-setup-step")?.closest("main") as HTMLElement;
        const durations: number[] = [];
        let maxNodes = 0;
        for (let turn = 0; turn < 26; turn++) {
          const before = heading();
          const started = performance.now();
          buttons[(turn + 1) % buttons.length].click();
          while (heading() === before) await new Promise(requestAnimationFrame);
          main.getBoundingClientRect();
          if (turn > 1) durations.push(performance.now() - started);
          maxNodes = Math.max(maxNodes, main.querySelectorAll("*").length);
          await new Promise(requestAnimationFrame);
        }
        durations.sort((left, right) => left - right);
        return {
          medianMs: durations[Math.floor(durations.length / 2)],
          p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
          samples: durations.length,
          maxNodes,
          videos: document.querySelectorAll("[data-team-setup-video]").length,
        };
      });
      expect(metrics.medianMs).toBeLessThan(40);
      expect(metrics.p95Ms).toBeLessThan(100);
      expect(metrics.maxNodes).toBeLessThan(400);
      expect(metrics.videos).toBe(1);

      await page.getByRole("button", { name: /Richtlinie verteilen/ }).click();
      await page.waitForSelector('[data-team-setup-video="playing"]');
      await page.setViewportSize({ width: 1440, height: 420 });
      await page.evaluate(() => {
        const main = document.getElementById("team-setup-step")?.closest("main") as HTMLElement;
        main.scrollTop = main.scrollHeight;
      });
      await page.waitForSelector('[data-team-setup-video="paused"]', { state: "attached" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => {
        (document.getElementById("team-setup-step")?.closest("main") as HTMLElement).scrollTop = 0;
      });
      await page.waitForSelector('[data-team-setup-video="playing"]');
      await page.getByRole("button", { name: "Video pausieren" }).click();
      const caption = page.locator("figure[data-team-setup-video] figcaption p").first();
      const pausedAt = await caption.textContent();
      await page.waitForTimeout(1500);
      const snapshot = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("[data-team-setup-video] *")].map((node) => {
            const style = getComputedStyle(node);
            return `${style.transform}|${style.opacity}`;
          }),
        );
      const before = await snapshot();
      await page.waitForTimeout(3500);
      const after = await snapshot();
      const idle = {
        changedNodes: after.filter((value, index) => value !== before[index]).length,
      };
      expect(await caption.textContent()).toBe(pausedAt);
      expect(after.length).toBe(before.length);
      expect(idle.changedNodes).toBe(0);

      await page.getByRole("button", { name: "Einstellungen", exact: true }).first().click();
      await page.waitForURL(/\/settings/);
      expect(await page.locator('[data-team-setup-video="playing"]').count()).toBe(0);
      expect(media).toEqual([]);

      await reportScenario(`team-setup-${engine}`, {
        browser: browser.version(),
        steps: 6,
        stepSwitches: metrics.samples,
        ...metrics,
        changedVideoNodesWhilePaused: idle.changedNodes,
        mediaRequests: media.length,
      });
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
