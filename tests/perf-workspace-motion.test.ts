import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_MOTION_BROWSER_URL;

for (const engine of [chromium, webkit]) {
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
          await new Promise((resolve) => setTimeout(resolve, 300));
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
            ...result,
          }),
        );
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}
