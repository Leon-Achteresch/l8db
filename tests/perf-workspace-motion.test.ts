import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_MOTION_BROWSER_URL;

for (const engine of process.env.L8DB_MOTION_ENGINE === "chromium"
  ? [chromium]
  : [chromium, webkit]) {
  test.skipIf(!base)(
    `${engine.name()}: workspace motion preserves input and bounds work on 9,600 data cells`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          Object.assign(window, {
            motionDbCalls: 0,
            __TAURI_INTERNALS__: {
              invoke: async () => {
                (window as unknown as { motionDbCalls: number }).motionDbCalls++;
                return [];
              },
            },
          });
        });
        await page.goto(`${base}/tests/fixtures/workspace-motion.html`);
        await page.locator("tr").last().waitFor();
        await page.waitForFunction(() => document.getAnimations().length === 0);
        await page.getByRole("textbox", { name: "Entwurf" }).fill("SELECT ungespeichert;");
        const result = await page.evaluate(async () => {
          const api = window.workspaceMotion;
          const surface = document.querySelector<HTMLElement>("[data-slot=change-surface]")!;
          const firstCell = surface.querySelector("td");
          const initialNodes = document.querySelectorAll("*").length;
          const input = document.activeElement;
          const setup: number[] = [];
          const paint: number[] = [];
          let peakAnimations = 0;
          for (let index = 0; index < 180; index++) {
            const start = performance.now();
            api.change();
            setup.push(performance.now() - start);
            peakAnimations = Math.max(peakAnimations, surface.getAnimations().length);
            await new Promise(requestAnimationFrame);
            paint.push(performance.now() - start);
          }
          for (let index = 0; index < 1000; index++) api.change();
          peakAnimations = Math.max(peakAnimations, surface.getAnimations().length);
          const stop = api.play();
          stop();
          const cancelled = surface.getAnimations().length;
          await Promise.all(
            document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
          );
          api.redraw();
          const idle = document.getAnimations().length;
          setup.sort((a, b) => a - b);
          paint.sort((a, b) => a - b);
          return {
            setupMedianMs: setup[90],
            setupP95Ms: setup[171],
            paintMedianMs: paint[90],
            paintP95Ms: paint[171],
            peakAnimations,
            cancelled,
            idle,
            initialNodes,
            nodeGrowth: document.querySelectorAll("*").length - initialNodes,
            sameCell: firstCell === surface.querySelector("td"),
            sameInput: input === document.activeElement,
            dbCalls: (window as unknown as { motionDbCalls: number }).motionDbCalls,
          };
        });
        expect(result.setupMedianMs).toBeLessThan(4);
        expect(result.setupP95Ms).toBeLessThan(12);
        expect(result.paintP95Ms).toBeLessThan(80);
        expect(result.peakAnimations).toBe(1);
        expect(result.cancelled).toBe(0);
        expect(result.idle).toBe(0);
        expect(result.nodeGrowth).toBe(0);
        expect(result.sameCell).toBe(true);
        expect(result.sameInput).toBe(true);
        expect(result.dbCalls).toBe(0);
        const section = await page.evaluate(async () => {
          const element = document.createElement("div");
          element.style.cssText =
            "position:fixed;inset:100px 20px auto auto;width:300px;height:400px;overflow:hidden";
          for (let index = 0; index < 500; index++) {
            const row = document.createElement("div");
            row.dataset.settingId = `setting-${index}`;
            row.textContent = `Einstellung ${index}`;
            element.append(row);
          }
          document.body.append(element);
          const starts: number[] = [];
          let peak = 0;
          let stop = () => undefined;
          for (let index = 0; index < 100; index++) {
            const started = performance.now();
            stop = window.workspaceMotion.section(element);
            starts.push(performance.now() - started);
            peak = Math.max(peak, element.getAnimations({ subtree: true }).length);
          }
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => undefined)),
          );
          const idle = element.getAnimations({ subtree: true }).length;
          stop = window.workspaceMotion.section(element);
          stop();
          const cancelled = element.getAnimations({ subtree: true }).length;
          element.remove();
          starts.sort((a, b) => a - b);
          return { medianMs: starts[50], p95Ms: starts[95], peak, idle, cancelled };
        });
        expect(section.p95Ms).toBeLessThan(12);
        expect(section.peak).toBe(7);
        expect(section.idle).toBe(0);
        expect(section.cancelled).toBe(0);
        expect(await page.getByRole("textbox", { name: "Entwurf" }).inputValue()).toBe(
          "SELECT ungespeichert;",
        );

        await page.getByRole("switch").click();
        expect(await page.getByRole("switch").getAttribute("aria-checked")).toBe("true");
        await page.getByRole("checkbox").focus();
        await page.keyboard.press("Space");
        expect(await page.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
        await page.getByRole("tab", { name: "Struktur", exact: true }).click();
        expect(await page.getByRole("tabpanel").innerText()).toContain("24 Spalten");
        await page.getByRole("tab", { name: "Daten", exact: true }).click();

        await page.evaluate(() => window.workspaceMotion.panel(true));
        await page.getByRole("region", { name: "Transaktionen", exact: true }).waitFor();
        await page.waitForFunction(() => {
          const panel = document.querySelector('[data-tour="tx-panel"]');
          return panel && Math.abs(panel.getBoundingClientRect().width - 380) < 0.5;
        });
        expect(
          await page
            .locator('[data-slot="change-surface"]')
            .evaluate((node) => node.getBoundingClientRect().width),
        ).toBeGreaterThan(1000);
        await page.evaluate(() => window.workspaceMotion.panel(false));
        expect(await page.locator('[data-tour="tx-panel"]').getAttribute("inert")).not.toBeNull();
        await page.locator('[data-tour="tx-panel"]').waitFor({ state: "detached" });

        await page.emulateMedia({ reducedMotion: "reduce" });
        const reduced = await page.evaluate(() => {
          window.workspaceMotion.change();
          const surface = document.querySelector<HTMLElement>("[data-slot=change-surface]")!;
          const animation = surface.getAnimations()[0];
          return {
            frames: (animation.effect as KeyframeEffect).getKeyframes(),
            duration: animation.effect!.getTiming().duration,
          };
        });
        expect(
          reduced.frames.every((frame) => !frame.transform || frame.transform === "none"),
        ).toBe(true);
        expect(reduced.duration).toBe(100);
        await page.getByRole("button", { name: "Ansicht wechseln" }).hover();
        await page.mouse.down();
        const pressedScale = await page
          .getByRole("button", { name: "Ansicht wechseln" })
          .evaluate((node) => getComputedStyle(node).scale);
        await page.mouse.up();
        expect(pressedScale).toBe("1");
        await page.waitForFunction(() => document.getAnimations().length === 0);

        await mkdir("test-artifacts/motion", { recursive: true });
        for (const theme of ["light", "dark"]) {
          await page.evaluate((theme) => {
            document.documentElement.classList.toggle("dark", theme === "dark");
          }, theme);
          await page.screenshot({ path: `test-artifacts/motion/${engine.name()}-${theme}.png` });
        }
        await page.setViewportSize({ width: 960, height: 720 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          960,
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const afterUnmount = await page.evaluate(() => {
          window.workspaceMotion.change();
          window.workspaceMotion.unmount();
          return document.getAnimations().length;
        });
        expect(afterUnmount).toBe(0);
        expect(errors).toEqual([]);
        console.log(
          JSON.stringify({
            suite: "workspace-motion",
            engine: engine.name(),
            browser: browser.version(),
            os: platform(),
            architecture: arch(),
            cpu: cpus()[0].model,
            ramGiB: totalmem() / 1024 ** 3,
            runtime: `Bun ${Bun.version}`,
            cells: 9600,
            switches: 1180,
            section,
            ...result,
          }),
        );
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  test.skipIf(!base)(
    `${engine.name()}: 50 tab strips share bounded fluid highlights`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(`${base}/tests/fixtures/motion-tabs.html`);
        await page.getByRole("tablist").last().waitFor();
        const timings = await page.evaluate(async () => {
          const lists = document.querySelectorAll('[role="tablist"]');
          const tabs = lists[0].querySelectorAll<HTMLElement>('[role="tab"]');
          const nodes = document.querySelectorAll("*").length;
          const durations: number[] = [];
        let selections = 0;
          for (let index = 0; index < 100; index++) {
            const start = performance.now();
          const target = tabs[(index + 1) % tabs.length];
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            durations.push(performance.now() - start);
          if (target.getAttribute("aria-selected") === "true") selections++;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
          let idleWrites = 0;
          const observer = new MutationObserver((records) => {
            idleWrites += records.length;
          });
          observer.observe(document.body, { subtree: true, attributes: true, childList: true });
          await new Promise((resolve) => setTimeout(resolve, 150));
          observer.disconnect();
          durations.sort((a, b) => a - b);
          return {
            medianMs: durations[50],
            p95Ms: durations[95],
            nodes,
            nodeGrowth: document.querySelectorAll("*").length - nodes,
            highlights: document.querySelectorAll("[data-motion-highlight]").length,
            idleWrites,
          selections,
          };
        });
        expect(timings.p95Ms).toBeLessThan(120);
        expect(timings.nodeGrowth).toBe(0);
        expect(timings.highlights).toBe(50);
      expect(timings.selections).toBe(100);
        expect(timings.idleWrites).toBe(0);
        const selected = page
          .getByRole("tablist", { name: "group-0", exact: true })
          .getByRole("tab", { selected: true });
        await selected.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          () =>
            document.querySelector(
              '[role="tablist"][aria-label="group-0"] [role="tab"][aria-selected="true"]',
            )?.textContent === "Tab 1",
        );
        expect(
          await page
            .getByRole("tablist", { name: "group-0", exact: true })
            .getByRole("tab", { selected: true })
            .innerText(),
        ).toBe("Tab 1");
        const line = page.getByRole("tablist", { name: "group-1", exact: true });
        await line.getByRole("tab", { name: "Tab 3", exact: true }).click();
        expect(await line.locator("[data-motion-highlight]").count()).toBe(1);
        console.log(
          JSON.stringify({
            suite: "motion-tabs",
            engine: engine.name(),
            strips: 50,
            options: 500,
            switches: 100,
            ...timings,
          }),
        );
      } finally {
        await browser.close();
      }
    },
    60000,
  );
}
