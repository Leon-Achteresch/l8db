import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_DASHBOARD_DESIGN_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!base)(
    `${engine.name()}: 5,000 CSS rules, bounded styles, cancellation and idle`,
    async () => {
      const browser = await engine.launch();
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      try {
        await page.goto(`${base}/tests/fixtures/dashboard-design.html`);
        await page.locator(".dashboard-widget").first().waitFor();
        const result = await page.evaluate(async () => {
          const runtime = window as unknown as {
            dashboardDesign: typeof import("../src/lib/dashboard-design");
            dashboardDesignCalls: { command: string }[];
          };
          const api = runtime.dashboardDesign;
          const css = Array.from(
            { length: 5000 },
            (_, i) => `.dashboard-widget.r${i}{color:#abcdef}`,
          ).join("\n");
          const sourceBytes = new TextEncoder().encode(css).byteLength;
          const surface = document.querySelector<HTMLElement>(".dashboard-surface")!;
          const card = surface.querySelector<HTMLElement>(".dashboard-widget")!;
          card.classList.add("r0");
          const scope = `#${CSS.escape(surface.id)}`;
          const style = document.createElement("style");
          style.dataset.perfDesign = "true";
          document.head.appendChild(style);
          const initialSheets = document.adoptedStyleSheets.length;
          const samples: number[] = [];
          const stages: number[][] = [[], [], []];
          let compiled: CSSStyleSheet | undefined;
          let visibleEdits = 0;
          for (let sample = 0; sample < 22; sample++) {
            const start = performance.now();
            const editedCss = css.replace("#abcdef", sample % 2 ? "#fedcba" : "#abcdef");
            compiled = api.compileDashboardStylesheet(
              editedCss,
              scope,
              api.dashboardStylesheet(style),
            );
            const parsedAt = performance.now();
            api.applyDashboardStylesheet(style, compiled);
            const insertedAt = performance.now();
            const color = getComputedStyle(card).color;
            if (color === (sample % 2 ? "rgb(254, 220, 186)" : "rgb(171, 205, 239)"))
              visibleEdits++;
            if (sample >= 2) {
              samples.push(performance.now() - start);
              stages[0].push(parsedAt - start);
              stages[1].push(insertedAt - parsedAt);
              stages[2].push(performance.now() - insertedAt);
            }
          }
          samples.sort((a, b) => a - b);
          const compiledBytes = new TextEncoder().encode(
            Array.from(compiled?.cssRules ?? [], (rule) => rule.cssText).join("\n"),
          ).byteLength;
          compiled = undefined;
          let applications = 0;
          const replace = CSSStyleSheet.prototype.replaceSync;
          CSSStyleSheet.prototype.replaceSync = function (css: string) {
            applications++;
            replace.call(this, css);
          };
          const controller = api.createDashboardStyleController(style, scope, () => undefined);
          for (let update = 0; update < 1000; update++)
            controller.update({ css: ".dashboard-widget { opacity: 0.9; }", enabled: true });
          await new Promise((resolve) => setTimeout(resolve, api.DASHBOARD_CSS_DELAY_MS + 40));
          const applied = applications;
          const retainedStyles = document.querySelectorAll("style[data-perf-design]").length;
          const retainedRules = api.dashboardStylesheet(style)?.cssRules.length ?? 0;
          const retainedSheets = document.adoptedStyleSheets.length - initialSheets;
          await new Promise((resolve) => setTimeout(resolve, 250));
          const idle = applications - applied;
          controller.update({ css: ".dashboard-widget { opacity: 0.1; }", enabled: true });
          controller.dispose();
          const afterDispose = applications;
          await new Promise((resolve) => setTimeout(resolve, api.DASHBOARD_CSS_DELAY_MS + 40));
          const abandoned = applications - afterDispose;
          const remaining = document.querySelectorAll("style[data-perf-design]").length;
          const remainingSheets = document.adoptedStyleSheets.length - initialSheets;
          CSSStyleSheet.prototype.replaceSync = replace;
          return {
            stages: stages.map((stage) => stage.sort((a, b) => a - b)[10]),
            visibleEdits,
            sourceBytes,
            compiledBytes,
            medianMs: samples[10],
            p95Ms: samples[18],
            applied,
            idle,
            abandoned,
            retainedStyles,
            retainedRules,
            retainedSheets,
            remaining,
            remainingSheets,
            databaseRequests: runtime.dashboardDesignCalls.filter(
              (call) => call.command === "execute_query",
            ).length,
          };
        });
        console.log(
          JSON.stringify({
            scenario: "dashboard-css",
            engine: engine.name(),
            runtime: await browser.version(),
            os: platform(),
            arch: arch(),
            cpu: cpus()[0]?.model,
            ramBytes: totalmem(),
            rules: 5000,
            rapidEdits: 1000,
            ...result,
          }),
        );
        expect(result.sourceBytes).toBeLessThanOrEqual(256 * 1024);
        expect(result.visibleEdits).toBe(22);
        expect(result.compiledBytes).toBeLessThan(1500000);
        expect(result.medianMs).toBeLessThan(50);
        expect(result.p95Ms).toBeLessThan(100);
        expect(result.applied).toBe(1);
        expect(result.retainedStyles).toBe(1);
        expect(result.retainedRules).toBe(1);
        expect(result.retainedSheets).toBe(1);
        expect(result.idle).toBe(0);
        expect(result.abandoned).toBe(0);
        expect(result.remaining).toBe(0);
        expect(result.remainingSheets).toBe(0);
        expect(result.databaseRequests).toBe(0);
      } finally {
        await browser.close();
      }
    },
    30000,
  );
}
