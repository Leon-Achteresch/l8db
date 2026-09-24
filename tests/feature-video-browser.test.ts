import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { ASSET_BASE, FEED_URL } from "../src/lib/feature-videos/model";
import config from "../src-tauri/tauri.conf.json";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_FEATURE_VIDEO_BROWSER)(
  "feature videos autoplay silently, pause for dialogs, dismiss persistently and replay manually",
  async () => {
    const artifacts = resolve("test-artifacts/feature-videos-browser");
    await mkdir(artifacts, { recursive: true });
    const clip = resolve(artifacts, "clip.webm");
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-t",
      "12",
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "120k",
      clip,
    ]);
    const media = await readFile(process.env.L8DB_FEATURE_VIDEO_PREVIEW ?? clip);
    const now = Date.now();
    const item = {
      id: "easy-mode",
      revision: "1",
      title: "Mehr Ruhe mit Easy Mode",
      summary: "Verbindungen, Tabellen und SQL im Fokus.",
      releaseVersion: "0.6.128",
      minAppVersion: "0.6.128",
      sourceCommit: "64b344ea",
      publishedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      priority: 90,
      platforms: ["macos", "windows", "linux"],
      modes: ["easy", "normal"],
      requiredCapabilities: [],
      actionId: "settings",
      durationSeconds: 12,
      poster: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.jpg`,
      sources: [
        {
          url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.webm`,
          type: "video/webm",
          bytes: media.length,
        },
        {
          url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.mp4`,
          type: "video/mp4",
          bytes: media.length,
        },
      ],
    };
    const feed = {
      schemaVersion: 1,
      generatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 86_400_000).toISOString(),
      items: [item],
    };
    const root = resolve("dist");
    const policy = Object.entries(config.app.security.csp)
      .map(([key, value]) => `${key} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = resolve(root, `.${new URL(request.url).pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        return new Response(
          path !== root && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
          { headers: { "Content-Security-Policy": policy } },
        );
      },
    });
    const engine = process.env.L8DB_FEATURE_VIDEO_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors: string[] = [];
      const downloads: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 8);
      await page.addInitScript(() => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        internals.invoke = async (command, args) =>
          command === "plugin:app|version" ? "0.6.200" : invoke(command, args);
        const violations: string[] = [];
        Object.assign(window, { featureViolations: violations });
        document.addEventListener("securitypolicyviolation", (event) =>
          violations.push(event.violatedDirective),
        );
      });
      await page.route(FEED_URL, (route) =>
        route.fulfill({
          json: { tag_name: "feature-videos", draft: false, body: JSON.stringify(feed) },
          headers: { "Access-Control-Allow-Origin": "*" },
        }),
      );
      await page.route(`${ASSET_BASE}**`, (route) => {
        const url = route.request().url();
        downloads.push(url);
        return route.fulfill(
          url.endsWith("jpg")
            ? { status: 404 }
            : {
                body: media,
                contentType: "video/webm",
                headers: { "Access-Control-Allow-Origin": "*" },
              },
        );
      });
      await page.goto(`http://localhost:${server.port}/release-notes`);
      await page.getByRole("heading", { name: "Release Notes", exact: true }).waitFor();
      await page.waitForTimeout(1500);
      expect(downloads).toEqual([]);
      const card = page.locator("[data-feature-video]");
      await card.waitFor({ state: "visible", timeout: 20000 });
      await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return video && !video.paused && video.currentTime > 0;
      });
      expect(await card.locator("video").evaluate((video) => video.muted)).toBe(true);
      expect(downloads.filter((url) => !url.endsWith("jpg"))).toHaveLength(1);
      await page.screenshot({
        path: resolve(artifacts, `card-${process.env.L8DB_FEATURE_VIDEO_BROWSER}.png`),
      });
      await card.getByRole("button", { name: "Video pausieren" }).click();
      expect(await card.locator("video").evaluate((video) => video.paused)).toBe(true);
      await page.evaluate(() => {
        const modal = document.createElement("div");
        modal.id = "test-modal";
        modal.setAttribute("role", "dialog");
        modal.textContent = "Dialog";
        document.body.append(modal);
      });
      await card.waitFor({ state: "hidden" });
      await page.evaluate(() => document.getElementById("test-modal")?.remove());
      await card.waitFor({ state: "visible" });
      expect(await card.locator("video").evaluate((video) => video.paused)).toBe(true);
      await card.getByRole("button", { name: "Video vergrößern" }).click();
      expect((await card.boundingBox())?.width).toBeGreaterThan(360);
      await card.getByRole("button", { name: "Feature-Video schließen" }).click();
      await card.waitFor({ state: "detached" });
      expect(await page.locator("video").count()).toBe(0);
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("l8db.feature-videos") ?? "{}"),
      );
      expect(saved.state.history["easy-mode"].status).toBe("dismissed");
      await page.reload();
      await page.waitForTimeout(11500);
      expect(await card.count()).toBe(0);
      await page.getByRole("button", { name: /12 Sekunden Mehr Ruhe/ }).click();
      await card.waitFor({ state: "visible" });
      await page.setViewportSize({ width: 760, height: 560 });
      await card.getByRole("button", { name: "Video vergrößern" }).click();
      const box = await card.boundingBox();
      expect(
        box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 760 && box.y + box.height <= 560,
      ).toBe(true);
      await card.getByRole("button", { name: "Feature-Video schließen" }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: /12 Sekunden Mehr Ruhe/ }).click();
      await card.waitFor({ state: "visible" });
      expect(await card.locator("video").evaluate((video) => video.paused)).toBe(true);
      await card.getByRole("button", { name: "Feature-Video schließen" }).click();
      await page.route(`${ASSET_BASE}**`, (route) => route.fulfill({ status: 404 }));
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("button", { name: /12 Sekunden Mehr Ruhe/ }).click();
      await card.getByRole("status").waitFor();
      expect(await card.getByRole("status").textContent()).toContain("nicht verfügbar");
      await card.getByRole("button", { name: "Feature-Video schließen" }).click();
      await page.route(`${ASSET_BASE}**`, (route) =>
        route.fulfill({ body: media, contentType: "video/webm" }),
      );
      await page.evaluate(() => {
        HTMLMediaElement.prototype.play = () =>
          Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
      });
      await page.getByRole("button", { name: /12 Sekunden Mehr Ruhe/ }).click();
      await page.waitForTimeout(500);
      expect(await card.locator("video").evaluate((video) => video.paused)).toBe(true);
      await card.getByRole("link", { name: "Feature öffnen" }).click();
      await page.getByRole("heading", { name: "Allgemein", exact: true }).waitFor();
      expect(new URL(page.url()).searchParams.get("tab")).toBe("general");
      await page.getByRole("button", { name: /Über & Updates/ }).click();
      await page.waitForURL("**/settings?tab=about");
      expect(new URL(page.url()).searchParams.get("tab")).toBe("about");
      await page.getByRole("button", { name: "Allgemein Design & Oberfläche" }).click();
      await page.getByRole("heading", { name: "Allgemein", exact: true }).waitFor();
      await page.route(FEED_URL, (route) => route.abort());
      await page.evaluate(() => localStorage.removeItem("l8db.feature-videos"));
      await page.goto(`http://localhost:${server.port}/release-notes`);
      await page
        .getByRole("status")
        .filter({ hasText: "Feature-Videos sind gerade nicht erreichbar" })
        .waitFor();
      expect(await card.count()).toBe(0);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as { featureViolations: string[] }).featureViolations,
        ),
      ).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);
