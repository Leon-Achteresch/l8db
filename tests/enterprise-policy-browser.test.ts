import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_ENTERPRISE_BROWSER)(
  "managed settings and team onboarding remain usable and bounded",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(root, `.${pathname}`);
        if (path !== root && !path.startsWith(`${root}/`))
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        return new Response(
          pathname !== "/" && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
        );
      },
    });
    const browser = await (process.env.L8DB_ENTERPRISE_BROWSER === "webkit"
      ? webkit
      : chromium
    ).launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        const original = internals.invoke;
        internals.invoke = (command, args) =>
          command === "team_connections"
            ? Promise.resolve({
                path: "/etc/l8db/policy.json",
                exists: true,
                connections: [
                  {
                    id: "reporting",
                    name: "Reporting",
                    kind: "postgres",
                    connectionString: "postgres://db.internal/reporting",
                    readOnly: true,
                    owner: "DBA-Testteam",
                    contact: "Serviceportal-Test",
                  },
                ],
              })
            : command === "organization_policy"
              ? Promise.resolve({
                  managed: true,
                  path: "/etc/l8db/policy.json",
                  organization: "Enterprise-Test",
                  support: "DBA Serviceportal",
                  settings: { productionReadOnly: true, sshTrustNewHosts: false },
                  allowAi: false,
                  allowExtensions: false,
                  allowPersonalSync: false,
                  allowMcp: false,
                  connections: [],
                })
              : original(command, args);
      });
      await page.goto(`http://localhost:${server.port}/settings?tab=general`);
      await page.getByText("Enterprise-Test", { exact: true }).waitFor();
      expect(await page.getByText("Durch die IT gesperrt:", { exact: false }).count()).toBe(1);
      await mkdir("test-artifacts/enterprise", { recursive: true });
      await page.screenshot({
        path: "test-artifacts/enterprise/managed-general.png",
        fullPage: true,
      });
      await page.goto(`http://localhost:${server.port}/settings?tab=security`);
      const locked = page.getByRole("switch", {
        name: "Produktion standardmäßig schreibgeschützt öffnen",
      });
      await locked.waitFor();
      expect(await locked.isDisabled()).toBe(true);
      expect(await locked.isChecked()).toBe(true);
      expect(await page.getByText("Von IT verwaltet", { exact: true }).count()).toBe(2);
      expect(await page.locator("*").count()).toBeLessThan(5000);
      await page.screenshot({
        path: "test-artifacts/enterprise/managed-security.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 760, height: 900 });
      await page.screenshot({
        path: "test-artifacts/enterprise/managed-security-small.png",
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.goto(`http://localhost:${server.port}/connections`);
      const help = page.getByText("Team-Verbindung · Hilfe & Zuständigkeit", { exact: true });
      await help.click();
      await page.getByText("Verantwortlich: DBA-Testteam", { exact: true }).waitFor();
      expect(
        await page.getByText("Zugriff beantragen: Serviceportal-Test", { exact: true }).count(),
      ).toBe(1);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
