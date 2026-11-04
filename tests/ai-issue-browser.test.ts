import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import catalog from "../scripts/feature-videos/catalog.json";
import { ASSET_BASE } from "../src/lib/feature-videos/model";
import { seedAiWorkspace } from "./fixtures/ai-workspace";

test.skipIf(!process.env.L8DB_AI_ISSUE_BROWSER)(
  "issue cards preview, cancel, publish and restore without repeated requests",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = resolve(root, `.${new URL(request.url).pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        return new Response(
          path !== root && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
        );
      },
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "dark",
      });
      const errors: string[] = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => errors.push(error.message));
      await seedAiWorkspace(page);
      await page.addInitScript(() => {
        const connections = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({ ...connections, state: { ...connections.state, activeId: null } }),
        );
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        Object.assign(window, {
          aiIssueDatabaseRequests: 0,
          aiIssueDatabaseCommands: [] as string[],
        });
        internals.invoke = (command, args) => {
          if (/^(fetch_|count_|execute_query|list_|get_schema_map)/.test(command)) {
            (window as unknown as { aiIssueDatabaseRequests: number }).aiIssueDatabaseRequests++;
            (
              window as unknown as { aiIssueDatabaseCommands: string[] }
            ).aiIssueDatabaseCommands.push(command);
          }
          return command === "plugin:app|version"
            ? Promise.resolve("0.17.0")
            : invoke(command, args);
        };
      });
      const now = Date.now();
      const clip = catalog.find((item) => item.id === "ai-issue-report");
      const prefix = `${ASSET_BASE}feature-video-ai-issue-report-1/fv-ai-issue-report-1`;
      const feed = {
        schemaVersion: 1,
        generatedAt: new Date(now).toISOString(),
        validUntil: new Date(now + 86400000).toISOString(),
        items: [
          {
            ...clip,
            releaseVersion: "0.17.0",
            minAppVersion: "0.17.0",
            publishedAt: new Date(now - 1000).toISOString(),
            expiresAt: new Date(now + 86400000).toISOString(),
            durationSeconds: 25,
            poster: `${prefix}.jpg`,
            sources: [
              { url: `${prefix}.mp4`, type: "video/mp4", bytes: 1000 },
              { url: `${prefix}.webm`, type: "video/webm", bytes: 1000 },
            ],
          },
        ],
      };
      await page.route("https://api.github.com/**", (route) =>
        route.fulfill({
          json: { tag_name: "feature-videos", draft: false, body: JSON.stringify(feed) },
        }),
      );
      let videoRequests = 0;
      await page.route(`${ASSET_BASE}**`, (route) => {
        if (/\.(mp4|webm)$/.test(route.request().url())) videoRequests++;
        return route.fulfill({ status: 404, body: "" });
      });
      await page.goto(`http://localhost:${server.port}/`);
      await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true });
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.connections") ?? "{}").state.activeId,
        ),
      ).toBeNull();
      await panel.getByRole("button", { name: /Probleme direkt als Issue melden/ }).click();
      const guide = page.getByRole("dialog", { name: "Aus einem Problem wird ein Issue" });
      await guide.getByText("Bewusst veröffentlichen.", { exact: true }).waitFor();
      await guide.locator("video").waitFor();
      expect(await guide.locator("video").getAttribute("preload")).toBe("none");
      expect(videoRequests).toBe(0);
      await page.keyboard.press("Escape");
      expect(await page.locator("video").count()).toBe(0);
      const prepare = async () => {
        await panel.getByLabel("Nachricht an AI").fill("Erstelle dafür ein Issue.");
        await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
        await panel.locator("[data-ai-issue-card]").last().waitFor();
      };
      await prepare();
      const card = panel.locator("[data-ai-issue-card]").last();
      expect(await card.locator("img").count()).toBe(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { aiFixture: { approvals: unknown[] } }).aiFixture.approvals
              .length,
        ),
      ).toBe(0);
      await card.getByRole("button", { name: "Vorschau", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Issue-Vorschau" });
      await modal.getByRole("heading", { name: "Umgebung", exact: true }).waitFor();
      await modal.getByAltText("Geschwärzter Screenshot für das GitHub-Issue").waitFor();
      await modal.evaluate((element) =>
        Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ),
      );
      await mkdir(resolve("test-artifacts/ai-issue"), { recursive: true });
      await page.screenshot({ path: resolve("test-artifacts/ai-issue/preview.png") });
      const layout = await modal.evaluate((dialog) => {
        const scroller = dialog.querySelector<HTMLElement>("[data-issue-preview-scroll]");
        if (!scroller) throw new Error("Scrollbereich fehlt");
        const box = dialog.getBoundingClientRect();
        scroller.scrollTop = scroller.scrollHeight;
        const last = scroller.querySelector("img")?.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        return {
          width: box.width,
          fits:
            box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
          overflowY: getComputedStyle(scroller).overflowY,
          horizontal: scroller.scrollWidth - scroller.clientWidth,
          endVisible: !!last && last.bottom <= view.bottom + 1,
        };
      });
      expect(layout.width).toBeGreaterThan(1100);
      expect(layout.fits).toBe(true);
      expect(layout.overflowY).toBe("auto");
      expect(layout.horizontal).toBeLessThanOrEqual(0);
      expect(layout.endVisible).toBe(true);
      await page.screenshot({ path: resolve("test-artifacts/ai-issue/preview-end.png") });
      await page.keyboard.press("Escape");
      await card.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await panel.getByText("Der Bericht wurde nicht veröffentlicht.", { exact: true }).waitFor();
      await prepare();
      await card.getByRole("button", { name: "Vorschau", exact: true }).click();
      await modal
        .getByRole("button", { name: "Öffentliches Issue erstellen", exact: true })
        .click();
      const published = panel.locator("[data-ai-issue-card]").last();
      await published.getByRole("link", { name: "Auf GitHub", exact: true }).waitFor();
      const durations: number[] = [];
      const databaseRequests = await page.evaluate(
        () => (window as unknown as { aiIssueDatabaseRequests: number }).aiIssueDatabaseRequests,
      );
      for (let index = 0; index < 8; index++) {
        const elapsed = await published
          .getByRole("button", { name: "Vorschau", exact: true })
          .evaluate(async (button) => {
            const start = performance.now();
            (button as HTMLButtonElement).click();
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            if (!document.querySelector('[role="dialog"]'))
              throw new Error("Issue-Vorschau nicht gerendert");
            return performance.now() - start;
          });
        await modal.getByRole("heading", { name: "Umgebung", exact: true }).waitFor();
        durations.push(elapsed);
        await page.keyboard.press("Escape");
        await modal.waitFor({ state: "hidden" });
      }
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
      expect(
        await page.evaluate(
          (start) =>
            (
              window as unknown as { aiIssueDatabaseCommands: string[] }
            ).aiIssueDatabaseCommands.slice(start),
          databaseRequests,
        ),
      ).toEqual([]);
      const beforeIdle = await page.evaluate(() =>
        JSON.stringify((window as unknown as { aiFixture: unknown }).aiFixture),
      );
      await page.waitForTimeout(1100);
      expect(
        await page.evaluate(() =>
          JSON.stringify((window as unknown as { aiFixture: unknown }).aiFixture),
        ),
      ).toBe(beforeIdle);
      expect(
        await page.evaluate(
          (start) =>
            (
              window as unknown as { aiIssueDatabaseCommands: string[] }
            ).aiIssueDatabaseCommands.slice(start),
          databaseRequests,
        ),
      ).toEqual([]);
      const approvals = await page.evaluate(
        () =>
          (window as unknown as { aiFixture: { approvals: { allow: boolean }[] } }).aiFixture
            .approvals,
      );
      expect(approvals.map((entry) => entry.allow)).toEqual([false, true]);
      durations.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          scenario: "ai-issue-modal",
          runs: durations.length,
          medianMs: durations[4],
          p95Ms: durations[7],
          approvals: approvals.length,
          idleRequests: 0,
          retainedDialogs: 0,
          databaseRequestsDuringPreviews: 0,
        }),
      );
      expect(durations[7]).toBeLessThan(1000);
      await page.waitForTimeout(300);
      await page.reload();
      await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
      await panel.getByRole("button", { name: "Gesprächsverlauf", exact: true }).click();
      await panel
        .getByRole("button", { name: /^Erstelle dafür ein Issue\./ })
        .first()
        .click();
      await panel
        .locator("[data-ai-issue-card]")
        .getByRole("link", { name: "Auf GitHub", exact: true })
        .waitFor();
      await panel
        .locator("[data-ai-issue-card]")
        .getByRole("button", { name: "Vorschau", exact: true })
        .click();
      await modal.getByRole("heading", { name: "Umgebung", exact: true }).waitFor();
      expect(await modal.locator("img").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
