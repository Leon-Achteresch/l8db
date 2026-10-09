import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "onboarding portal priority ends with the overlay and inactive onboarding adds no global DOM scan",
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
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
        stored.state.onboardingDone = false;
        localStorage.setItem("l8db.settings", JSON.stringify(stored));
      });
      await page.goto(`http://localhost:${server.port}/`);
      const overlay = page.getByRole("dialog", { name: "Willkommen bei l8db" });
      await overlay.waitFor();
      const portal = await page.evaluate(() => {
        const popup = document.createElement("div");
        popup.dataset.slot = "dialog-content";
        document.body.appendChild(popup);
        const host = document.createElement("div");
        host.dataset.slot = "query-history-host";
        host.dataset.perfOnboardingHost = "";
        Object.assign(host.style, {
          position: "fixed",
          inset: "0",
          contain: "layout style",
          zIndex: "50",
          pointerEvents: "none",
        });
        document.body.appendChild(host);
        const result = {
          active: document.body.hasAttribute("data-onboarding-active"),
          zIndex: Number(getComputedStyle(popup).zIndex),
          historyHostZIndex: Number(getComputedStyle(host).zIndex),
        };
        popup.remove();
        return result;
      });
      expect(portal).toEqual({ active: true, zIndex: 10_000_003, historyHostZIndex: 10_000_003 });
      await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
        saved.state.onboardingDone = true;
        const newValue = JSON.stringify(saved);
        localStorage.setItem("l8db.settings", newValue);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "l8db.settings",
            storageArea: localStorage,
            newValue,
          }),
        );
      });
      await overlay.waitFor({ state: "hidden" });
      await page.waitForFunction(() => !document.body.hasAttribute("data-onboarding-active"));
      const historyHostZIndex = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("[data-perf-onboarding-host]");
        if (!host) throw new Error("Onboarding history host is missing");
        const zIndex = Number(getComputedStyle(host).zIndex);
        host.remove();
        return zIndex;
      });
      expect(historyHostZIndex).toBe(50);
      if (engine === "chromium")
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", {
          rate: 4,
        });
      const metrics = await page.evaluate(async () => {
        const nodesBefore = document.querySelectorAll("*").length;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const durations: number[] = [];
        for (let turn = 0; turn < 11; turn++) {
          const fragment = document.createDocumentFragment();
          for (let index = 0; index < 1000; index++) {
            const node = document.createElement("span");
            node.className = "text-xs";
            node.textContent = String(index);
            fragment.appendChild(node);
          }
          const started = performance.now();
          host.appendChild(fragment);
          host.getBoundingClientRect();
          host.replaceChildren();
          host.getBoundingClientRect();
          if (turn > 1) durations.push(performance.now() - started);
          await new Promise(requestAnimationFrame);
        }
        host.remove();
        durations.sort((left, right) => left - right);
        return {
          medianMs: durations[4],
          p95Ms: durations[8],
          retainedFixtureNodes: host.childElementCount,
          nodesBefore,
          nodesAfter: document.querySelectorAll("*").length,
        };
      });
      expect(metrics.p95Ms).toBeLessThan(120);
      expect(metrics.retainedFixtureNodes).toBe(0);
      expect(metrics.nodesAfter).toBeLessThanOrEqual(metrics.nodesBefore + 10);
      await reportScenario(`onboarding-idle-style-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        mutatedNodes: 1000,
        samples: 9,
        historyHostPriorityDuringOverlay: portal.historyHostZIndex,
        historyHostPriorityAfterOverlay: historyHostZIndex,
        ...metrics,
      });
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "onboarding appearance steps switch table styles within budget and skip restores defaults",
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
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
        stored.state.onboardingDone = false;
        localStorage.setItem("l8db.settings", JSON.stringify(stored));
      });
      await page.goto(`http://localhost:${server.port}/`);
      await page.getByRole("dialog", { name: "Willkommen bei l8db" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.getByRole("heading", { name: "Wie sollen deine Tabellen aussehen?" }).waitFor();
      if (engine === "chromium")
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", {
          rate: 4,
        });
      const metrics = await page.evaluate(async () => {
        const frame = () => new Promise(requestAnimationFrame);
        await frame();
        const nodesBefore = document.querySelectorAll("*").length;
        const styles = ["compact", "semantic", "profile", "classic"];
        const durations: number[] = [];
        for (let turn = 0; turn < 12; turn++) {
          const style = styles[turn % styles.length];
          const started = performance.now();
          document.querySelector<HTMLElement>(`[data-table-style="${style}"] input`)?.click();
          await frame();
          await frame();
          const stored = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
          if (stored.state.tableStyle !== style) throw new Error(`style ${style} not applied`);
          if (turn > 2) durations.push(performance.now() - started);
        }
        durations.sort((left, right) => left - right);
        return {
          medianMs: durations[4],
          p95Ms: durations[8],
          nodesBefore,
          nodesAfter: document.querySelectorAll("*").length,
        };
      });
      expect(metrics.p95Ms).toBeLessThan(250);
      expect(metrics.nodesAfter).toBeLessThanOrEqual(metrics.nodesBefore + 20);
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('[data-table-style="profile"] input')?.click();
      });
      await page.getByRole("button", { name: "Überspringen", exact: true }).click();
      await page.getByRole("heading", { name: "Wie viel Werkzeug brauchst du?" }).waitFor();
      const settings = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db.settings") ?? "{}").state,
      );
      expect(settings.tableStyle).toBe("classic");
      expect(settings.monochromeCells).toBe(true);
      expect(settings.uiDensity).toBe("normal");
      await reportScenario(`onboarding-appearance-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        samples: 9,
        ...metrics,
      });
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
