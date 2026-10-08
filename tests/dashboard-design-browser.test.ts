import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_DASHBOARD_DESIGN_BROWSER_URL;

for (const engine of [chromium, webkit]) {
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
        const css =
          '.dashboard-surface { & + section { outline-color: rgb(1, 2, 3); } } .dashboard-widget::before { content: "CSS"; } :root { --fixture: works; } * { outline-color: rgb(1, 2, 3); } .dashboard-widget { border-radius: 31px; & + [data-testid="outside"] { display: none; } } @media (min-width: 800px) { [data-widget-id="card-0"] .dashboard-widget { border-radius: 33px; } }';
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
          };
        });
        expect(metrics.variable).toBe("works");
        expect(metrics.radius).toBe("33px");
        expect(metrics.pseudo).toBe('"CSS"');
        expect(metrics.outside).not.toBe("rgb(1, 2, 3)");
        expect(metrics.editor).not.toBe("rgb(1, 2, 3)");
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
