import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_DASHBOARD_DESIGN_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!base)(
    `${engine.name()}: native stylesheets preserve scope, CSS tokens and other owners`,
    async () => {
      const browser = await engine.launch();
      const page = await browser.newPage();
      try {
        await page.goto(`${base}/tests/fixtures/dashboard-design.html`);
        await page.locator(".dashboard-widget").first().waitFor();
        const result = await page.evaluate(() => {
          const api = (
            window as unknown as {
              dashboardDesign: typeof import("../src/lib/dashboard-design");
            }
          ).dashboardDesign;
          const root = document.querySelector<HTMLElement>(".dashboard-surface")!;
          const marker = document.createElement("style");
          document.head.append(marker);
          const other = new CSSStyleSheet();
          other.replaceSync("body { --other-owner: survives; }");
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, other];
          const errors: string[] = [];
          const controller = api.createDashboardStyleController(
            marker,
            `#${CSS.escape(root.id)}`,
            (error) => error && errors.push(error),
          );
          const css = String.raw`/* } body { color: red; } */ :\72 oot { --token: "body { :root }"; --object: { body: ":root" }; --valid: yes; } } [data-testid="outside"] { --escaped: broken; }`;
          controller.update({ css, enabled: true }, true);
          const style = getComputedStyle(root);
          const token = style.getPropertyValue("--token").trim();
          const object = style.getPropertyValue("--object").trim();
          const beforeInvalid = api.dashboardStylesheet(marker);
          controller.update({ css: "not-a-rule", enabled: true }, true);
          const preserved = api.dashboardStylesheet(marker) === beforeInvalid;
          const restored = getComputedStyle(root).getPropertyValue("--valid").trim();
          const scoped = api.dashboardStylesheet(marker)?.cssRules.length;
          const escaped = getComputedStyle(
            document.querySelector('[data-testid="outside"]')!,
          ).getPropertyValue("--escaped");
          controller.update({ css: "", enabled: false }, true);
          const cleared = getComputedStyle(root).getPropertyValue("--valid");
          controller.dispose();
          controller.dispose();
          const otherPreserved = document.adoptedStyleSheets.includes(other);
          const released = !api.dashboardStylesheet(marker) && !marker.isConnected;
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
            (sheet) => sheet !== other,
          );
          return {
            token,
            object,
            preserved,
            restored,
            scoped,
            escaped,
            cleared,
            otherPreserved,
            released,
            errors,
          };
        });
        expect(result.token).toBe('"body { :root }"');
        expect(result.object).toContain('body: ":root"');
        expect(result.preserved).toBe(true);
        expect(result.restored).toBe("yes");
        expect(result.scoped).toBe(1);
        expect(result.escaped).toBe("");
        expect(result.cleared).toBe("");
        expect(result.otherPreserved).toBe(true);
        expect(result.released).toBe(true);
        expect(result.errors).toHaveLength(1);
      } finally {
        await browser.close();
      }
    },
    15000,
  );
  test.skipIf(!base)(
    `${engine.name()}: dashboard CSS preview, import, persistence, recovery and AI`,
    async () => {
      const browser = await engine.launch();
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(`${base}/tests/fixtures/dashboard-design.html`);
        await page.getByRole("button", { name: "Design", exact: true }).click();
        const editor = page.getByRole("textbox", { name: "Dashboard-CSS" });
        await page.evaluate(() => {
          const read = File.prototype.text;
          const runtime = window as unknown as { finishCssImport?: () => void };
          File.prototype.text = function () {
            if (this.name !== "slow.css") return read.call(this);
            return new Promise<string>((resolve) => {
              runtime.finishCssImport = () => {
                File.prototype.text = read;
                resolve(".dashboard-widget { color: red; }");
              };
            });
          };
        });
        await page.getByLabel("CSS-Datei auswählen").setInputFiles({
          name: "slow.css",
          mimeType: "text/css",
          buffer: Buffer.from(".dashboard-widget { color: red; }"),
        });
        await page.waitForFunction(
          () => !!(window as unknown as { finishCssImport?: () => void }).finishCssImport,
        );
        await page.getByRole("button", { name: "Papier", exact: true }).click();
        await page.evaluate(async () => {
          (window as unknown as { finishCssImport: () => void }).finishCssImport();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(await editor.inputValue()).toContain("Georgia");
        const css =
          '@font-face { font-family: "fixture-font"; src: local("Arial"); } @keyframes fixture-pulse { from { opacity: 0.8; } to { opacity: 1; } } .dashboard-surface { & + section { outline-color: rgb(1, 2, 3); } } .dashboard-widget::before { content: "CSS"; } :root { --fixture: works; } * { outline-color: rgb(1, 2, 3); } .dashboard-widget { border-radius: 31px; & + [data-testid="outside"] { display: none; } } .dashboard-widget-title { font-family: "fixture-font", sans-serif; animation: fixture-pulse 2s infinite alternate; text-transform: uppercase; } @media (min-width: 800px) { [data-widget-id="card-0"] .dashboard-widget { border-radius: 33px; } }';
        await editor.fill(css);
        await page.waitForTimeout(230);
        const metrics = await page.evaluate(() => {
          const root = document.querySelector(".dashboard-surface")!;
          const outside = document.querySelector('[data-testid="outside"]')!;
          return {
            variable: getComputedStyle(root).getPropertyValue("--fixture").trim(),
            radius: getComputedStyle(
              document.querySelector('[data-widget-id="card-0"] .dashboard-widget')!,
            ).borderRadius,
            outside: getComputedStyle(outside).outlineColor,
            pseudo: getComputedStyle(document.querySelector(".dashboard-widget")!, "::before")
              .content,
            editor: getComputedStyle(document.querySelector("#dashboard-css")!).outlineColor,
            title: (() => {
              const style = getComputedStyle(document.querySelector(".dashboard-widget-title")!);
              return {
                font: style.fontFamily,
                animation: style.animationName,
                transform: style.textTransform,
                animations: document.querySelector(".dashboard-widget-title")!.getAnimations()
                  .length,
              };
            })(),
            fontDefined: Array.from(document.fonts).some(
              (font) => font.family.replaceAll('"', "") === "fixture-font",
            ),
          };
        });
        expect(metrics.variable).toBe("works");
        expect(metrics.radius).toBe("33px");
        expect(metrics.pseudo).toBe('"CSS"');
        expect(metrics.outside).not.toBe("rgb(1, 2, 3)");
        expect(metrics.editor).not.toBe("rgb(1, 2, 3)");
        expect(metrics.title.font).toContain("fixture-font");
        expect(metrics.title.animation).toBe("fixture-pulse");
        expect(metrics.title.transform).toBe("uppercase");
        expect(metrics.title.animations).toBeGreaterThan(0);
        expect(metrics.fontDefined).toBe(true);
        await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
        await page.waitForTimeout(230);
        expect(
          await page
            .locator(".dashboard-surface")
            .evaluate((root) => getComputedStyle(root).getPropertyValue("--fixture")),
        ).toBe("");
        await page.getByRole("button", { name: "Design", exact: true }).click();
        await page
          .getByLabel("CSS-Datei auswählen")
          .setInputFiles({ name: "custom.css", mimeType: "text/css", buffer: Buffer.from(css) });
        await page.waitForFunction(
          (value) => document.querySelector<HTMLTextAreaElement>("#dashboard-css")?.value === value,
          css,
        );
        expect(await editor.inputValue()).toBe(css);
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "Exportieren", exact: true }).click();
        expect((await download).suggestedFilename()).toBe("dashboard.css");
        await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
        await page.waitForTimeout(400);
        await page.reload();
        await page.locator('[data-widget-id="card-0"] .dashboard-widget').waitFor();
        await page.waitForTimeout(230);
        expect(
          await page
            .locator(".dashboard-surface")
            .evaluate((root) => getComputedStyle(root).getPropertyValue("--fixture").trim()),
        ).toBe("works");
        await page.getByRole("button", { name: "Design", exact: true }).click();
        await editor.fill(".dashboard-surface { display: none !important; }");
        await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
        await page.waitForTimeout(230);
        await page.keyboard.press("Control+Shift+D");
        await editor.waitFor();
        expect(await page.locator(".dashboard-toolbar").isVisible()).toBe(true);
        await page.getByRole("button", { name: "Design zurücksetzen", exact: true }).click();
        await page
          .getByLabel("Mit KI gestalten", { exact: true })
          .fill("Glas, violett, große Zahlen");
        await page.getByRole("button", { name: "Design mit KI ändern", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        const result = await page.evaluate(() => {
          const runtime = window as unknown as {
            dashboardDesignCalls: {
              command: string;
              args: { dashboard: { design: unknown; id: string } };
            }[];
            dashboardDesignAi: { getState: () => { pendingPrompt: string } };
            dashboardDesignStore: { getState: () => { dashboards: { mcpId: string }[] } };
          };
          return {
            calls: runtime.dashboardDesignCalls,
            prompt: runtime.dashboardDesignAi.getState().pendingPrompt,
            id: runtime.dashboardDesignStore.getState().dashboards[0].mcpId,
          };
        });
        expect(result.calls.filter((call) => call.command === "mcp_dashboard_save")).toHaveLength(
          1,
        );
        expect(result.calls.some((call) => call.command === "execute_query")).toBe(false);
        expect(result.prompt).toContain("Glas, violett, große Zahlen");
        expect(result.id).toBe("design-fixture");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    30000,
  );
}
