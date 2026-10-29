import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import {
  connectDemo,
  type DemoTab,
  seedUiPluginApp,
  serveBuiltApp,
} from "../tests/fixtures/ui-plugins-app";

const ORDERS = { schema: "sales", table: "orders" };
const ITEMS = { schema: "sales", table: "order_items" };
const CUSTOMERS = { schema: "crm", table: "customers" };
const TICKETS = { schema: "crm", table: "tickets" };
const TAB_BAR = { x: 360, y: 40, width: 1080, height: 380 };

type Scene = {
  path: string;
  tabs: DemoTab[];
  ready: string;
  production?: boolean;
  options?: Record<string, unknown>;
  clip?: typeof TAB_BAR;
  act?: (page: Page) => Promise<void>;
};

const SCENES: Record<string, Scene> = {
  "l8db.status-pills": {
    path: "/tables/sales/orders",
    tabs: [ORDERS, TICKETS],
    options: { tintRows: true },
    ready: '[data-ui-plugin="l8db.status-pills"]',
  },
  "l8db.money-and-dates": {
    path: "/tables/sales/orders",
    tabs: [ORDERS],
    ready: '[data-ui-plugin="l8db.money-and-dates"]',
  },
  "l8db.progress-bars": {
    path: "/tables/crm/customers",
    tabs: [CUSTOMERS, ORDERS],
    ready: '[data-ui-plugin="l8db.progress-bars"]',
  },
  "l8db.column-presets": {
    path: "/tables/sales/orders",
    tabs: [ORDERS],
    ready: '[data-column-id="due_date"]:has-text("Due date")',
  },
  "l8db.kanban": {
    path: "/tables/crm/tickets",
    tabs: [TICKETS, ORDERS],
    ready: "[data-board-column]",
    act: async (page) => {
      await page.getByRole("tab", { name: "Kanban" }).click();
    },
  },
  "l8db.copy-as-markdown": {
    path: "/tables/sales/orders",
    tabs: [ORDERS],
    ready: "text=als Markdown kopiert",
    act: async (page) => {
      await page.locator('tbody tr[data-index="2"] td[data-col="customer"]').click();
      await page
        .locator("[data-ui-plugin-toolbar]")
        .getByRole("button", { name: "Markdown" })
        .click();
    },
  },
  "l8db.tab-groups": {
    path: "/tables/sales/orders",
    tabs: [ORDERS, ITEMS, TICKETS, CUSTOMERS],
    ready: "[data-tab-group]",
    clip: TAB_BAR,
  },
  "l8db.prod-tab-warning": {
    path: "/tables/sales/orders",
    tabs: [ORDERS, ITEMS, TICKETS],
    production: true,
    ready: '[data-ui-plugin="l8db.prod-tab-warning"]',
    clip: TAB_BAR,
  },
  "l8db.split-workbench": {
    path: "/tables/sales/orders",
    tabs: [ORDERS],
    ready: '#split-1 td[data-col="product"]',
    act: async (page) => {
      await page.getByRole("button", { name: /^Tab-Gruppen/ }).click();
      await page.getByRole("menuitem", { name: "sales.orders → sales.order_items" }).click();
      await page.locator('#split-0 tbody tr[data-index="3"] td[data-col="customer"]').click();
    },
  },
};

async function shoot(
  pluginDir: string,
  files: Record<string, string>,
  scene: Scene,
  out: string,
  options: Record<string, Record<string, unknown>> = {},
) {
  const server = serveBuiltApp();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    page.setDefaultTimeout(20000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedUiPluginApp(page, files, {
      tabs: scene.tabs,
      environment: scene.production ? "production" : null,
      uiPlugins: { disabled: [], options, httpGrants: {}, installed: {} },
    });
    await page.goto(`http://localhost:${server.port}${scene.path}`);
    if (scene.production) {
      await connectDemo(page, scene.path);
      await page.getByText("Mit „Shop Produktion“ verbunden").waitFor({ state: "hidden" });
    }
    await page.locator("tbody tr").first().waitFor();
    await scene.act?.(page);
    await page.locator(scene.ready).first().waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: out, clip: scene.clip, animations: "disabled" });
    if (errors.length) throw new Error(`${pluginDir}: ${errors.join("; ")}`);
    const size = (await stat(out)).size;
    console.log(`${out} (${Math.round(size / 1024)} KB)`);
  } finally {
    await browser.close();
    server.stop(true);
  }
}

const root = resolve(process.argv[2] ?? "../l8db-ui-plugins");
const only = process.argv[3];
const plugins = join(root, "plugins");
const sources: Record<string, string> = {};
for (const dir of (await readdir(plugins)).sort()) {
  const file = (await readdir(join(plugins, dir))).find((name) =>
    /^plugin\.(tsx|ts|jsx|js)$/.test(name),
  );
  if (file) sources[dir] = await readFile(join(plugins, dir, file), "utf8");
}
for (const [id, scene] of Object.entries(SCENES)) {
  if (!sources[id] || (only && only !== id)) continue;
  await shoot(id, { [`${id}.tsx`]: sources[id] }, scene, join(plugins, id, "screenshot.png"), {
    [id]: scene.options ?? {},
  });
}
if (!only || only === "overview")
  await shoot(
    "overview",
    Object.fromEntries(Object.entries(sources).map(([id, source]) => [`${id}.tsx`, source])),
    { ...SCENES["l8db.split-workbench"], tabs: [ORDERS, TICKETS, CUSTOMERS], production: true },
    join(root, "overview.png"),
    { "l8db.status-pills": { tintRows: true } },
  );
