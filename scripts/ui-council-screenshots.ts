import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { seedUiPluginApp, serveBuiltApp } from "../tests/fixtures/ui-plugins-app";

const ORDERS = { schema: "sales", table: "orders" };
const TICKETS = { schema: "crm", table: "tickets" };
const CUSTOMERS = { schema: "crm", table: "customers" };

const SCENES: { name: string; path: string; wait?: string }[] = [
  { name: "home", path: "/" },
  { name: "table", path: "/tables/sales/orders", wait: "tbody tr" },
  { name: "query", path: "/query" },
  { name: "connections", path: "/connections" },
  { name: "settings", path: "/settings" },
];

const out = resolve(process.argv[2] ?? "test-artifacts/ui-council");
await mkdir(out, { recursive: true });
const server = serveBuiltApp();
const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"] as const) {
    for (const scene of SCENES) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: scheme,
      });
      page.setDefaultTimeout(20000);
      await seedUiPluginApp(page, {}, { tabs: [ORDERS, TICKETS, CUSTOMERS], environment: null });
      await page.goto(`http://localhost:${server.port}${scene.path}`);
      if (scene.wait) await page.locator(scene.wait).first().waitFor();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1200);
      const file = join(out, `${scene.name}-${scheme}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      console.log(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
