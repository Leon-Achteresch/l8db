import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import {
  connectDemo,
  navigateInApp,
  seedUiPluginApp,
  serveBuiltApp,
} from "./fixtures/ui-plugins-app";

const STATUS = `import { definePlugin, Pill } from "@l8db/ui";

const TONES = new Map([["offen", "warning"], ["bezahlt", "success"], ["versendet", "info"], ["storniert", "danger"]]);

export default definePlugin({
  id: "test.status",
  name: "Status",
  options: { mark: { type: "text", label: "Zeichen", default: "" } },
  slots: (options) => ({
    grid: {
      columns: (table) =>
        table.id === "sales.orders"
          ? [
              { id: "id", pinned: true, order: 0 },
              { id: "status", order: 1 },
              { id: "customer", label: "Kunde" },
              { id: "updated_by", hidden: true },
              { id: "total", align: "end", width: 140 },
            ]
          : undefined,
      cell: ({ table, column, value }) =>
        table.id === "sales.orders" && column.id === "status"
          ? <Pill tone={TONES.get(String(value)) ?? "neutral"}>{String(options.mark) + String(value)}</Pill>
          : undefined,
      rowTone: (row) => (row.status === "storniert" ? "danger" : undefined),
    },
  }),
});
`;

const TOOLS = `import { Board, definePlugin, Text } from "@l8db/ui";

export default definePlugin({
  id: "test.tools",
  name: "Werkzeuge",
  options: { limit: { type: "number", label: "Limit", min: 10, max: 500, default: 100 } },
  slots: {
    table: {
      toolbar: (table) =>
        table.id === "sales.orders"
          ? [
              {
                id: "copy",
                label: "Markdown",
                tone: "info",
                run: async (ctx) => {
                  await ctx.copy(["| id |", ...ctx.selection.map((row) => "| " + row.id + " |")].join("\\n"));
                  ctx.toast(ctx.selection.length + " Zeilen kopiert", "success");
                },
              },
            ]
          : undefined,
      detailTabs: (table) =>
        table.id === "crm.tickets"
          ? [
              {
                id: "kanban",
                label: "Kanban",
                render: ({ rows }) => (
                  <Board
                    columns={["neu", "in Arbeit", "wartet", "erledigt"].map((status) => ({
                      id: status,
                      label: status,
                      items: rows.filter((row) => row.status === status),
                    }))}
                    render={(row) => <Text>{String(row.title)}</Text>}
                  />
                ),
              },
            ]
          : undefined,
    },
  },
});
`;

const TABS = `import { Badge, definePlugin } from "@l8db/ui";

export default definePlugin({
  id: "test.tabs",
  name: "Tabs",
  slots: {
    tabs: {
      group: (tab) =>
        tab.table
          ? { id: tab.table.schema, label: tab.table.schema, tone: tab.table.schema === "crm" ? "info" : "success" }
          : undefined,
      item: ({ tab, Default }) =>
        tab.connection?.environment === "production" ? (
          <>
            <Default />
            <Badge tone="danger">PROD</Badge>
          </>
        ) : undefined,
      options: { closeButton: "always", newTabPosition: "afterActive" },
    },
  },
});
`;

const SPLIT = `import { definePlugin } from "@l8db/ui";

export default definePlugin({
  id: "test.split",
  name: "Split",
  slots: {
    split: {
      layout: (count) => (count === 3 ? "leftStack" : undefined),
      options: { autoSaveGroups: false },
      templates: [
        {
          id: "orders",
          name: "Bestellungen mit Positionen",
          panes: [
            { table: "sales.orders" },
            { table: "sales.order_items", master: 0, link: { column: "order_id", masterColumn: "id" } },
          ],
        },
        {
          id: "marketing",
          name: "Nur für Marketing",
          when: { connectionTag: "marketing" },
          panes: [{ table: "crm.customers" }, { table: "crm.tickets" }],
        },
      ],
    },
  },
});
`;

const BOOM = `import { definePlugin } from "@l8db/ui";

function Boom({ value }) {
  if (String(value).includes("Nordlicht")) throw new Error("kaputt");
  return <b>{String(value)}</b>;
}

export default definePlugin({
  id: "test.boom",
  name: "Boom",
  slots: {
    grid: {
      cell: ({ table, column, value }) =>
        table.id === "sales.orders" && column.id === "customer" ? <Boom value={value} /> : undefined,
    },
  },
});
`;

const HOOKS = `import { definePlugin } from "@l8db/ui";
import { useState } from "react";

export default definePlugin({
  id: "test.hooks",
  name: "Hooks",
  slots: {
    grid: {
      rowTone: (row) => {
        const [tone] = useState("info");
        return row.status === "offen" ? tone : undefined;
      },
    },
  },
});
`;

const GALLERY = `import { definePlugin, Text } from "@l8db/ui";

export default definePlugin({
  id: "test.gallery",
  name: "Galerie-Test",
  slots: {
    grid: {
      cell: ({ table, column, value }) =>
        table.id === "sales.orders" && column.id === "total" ? <Text mono>{"€ " + String(value)}</Text> : undefined,
    },
  },
});
`;

type Demo = {
  __uiPluginDemo: {
    setPlugin(name: string, source: string | null): void;
    written: Record<string, string>;
    calls: { command: string; args: Record<string, unknown> }[];
  };
  uiPluginViolations: string[];
};

test.skipIf(!process.env.L8DB_UI_PLUGINS_BROWSER)(
  "UI plugins render every slot in the built app, reload live and stay isolated",
  async () => {
    const server = serveBuiltApp();
    const engine = process.env.L8DB_UI_PLUGINS_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    try {
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await seedUiPluginApp(
        page,
        {
          "a-status.tsx": STATUS,
          "b-tools.tsx": TOOLS,
          "c-tabs.tsx": TABS,
          "d-split.tsx": SPLIT,
          "e-boom.jsx": BOOM,
          "f-hooks.tsx": HOOKS,
        },
        {
          tabs: [
            { schema: "sales", table: "orders" },
            { schema: "crm", table: "tickets" },
            { schema: "crm", table: "customers" },
          ],
          catalog: [{ id: "test.gallery", name: "Galerie-Test", source: GALLERY }],
        },
      );
      await page.addInitScript(() => {
        const violations: string[] = [];
        Object.assign(window, { uiPluginViolations: violations });
        document.addEventListener("securitypolicyviolation", (event) =>
          violations.push(`${event.violatedDirective}: ${event.blockedURI}`),
        );
      });
      await page.goto(`http://localhost:${server.port}/tables/sales/orders`);
      await connectDemo(page, "/tables/sales/orders");

      const pills = page.locator('[data-ui-plugin="test.status"]');
      await pills.first().waitFor();
      expect(await pills.count()).toBeGreaterThan(5);
      expect(await pills.first().textContent()).toMatch(/^(offen|bezahlt|versendet|storniert)$/);
      await page.locator('[data-column-id="customer"]').getByText("Kunde").waitFor();
      expect(await page.locator('[data-column-id="updated_by"]').count()).toBe(0);
      const headers = await page
        .locator("[data-column-id]")
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
      expect(headers.indexOf("id")).toBeLessThan(headers.indexOf("status"));
      expect(headers.indexOf("status")).toBeLessThan(headers.indexOf("customer"));
      const cancelled = page.locator("tbody tr").filter({ hasText: "storniert" }).first();
      expect(await cancelled.getAttribute("style")).toContain("#ef4444");

      const status = async () =>
        JSON.parse(
          (await page.evaluate(
            () => (window as unknown as Demo).__uiPluginDemo.written[".status.json"],
          )) ?? '{"plugins":[]}',
        ).plugins as { file: string; id?: string; state: string }[];
      await page.waitForFunction(() =>
        (window as unknown as Demo).__uiPluginDemo.written[".status.json"]?.includes(
          "useState ist direkt in Slot-Funktionen nicht erlaubt",
        ),
      );
      expect((await status()).find((plugin) => plugin.file === "f-hooks.tsx")?.state).toBe(
        "active",
      );

      const boom = page.locator('[data-ui-plugin="test.boom"]');
      await boom.locator("b").first().waitFor();
      await page.locator("tbody td").filter({ hasText: "Nordlicht Media" }).first().waitFor();

      await page.locator("[data-tab-group]").filter({ hasText: "sales" }).waitFor();
      await page.locator("[data-tab-group]").filter({ hasText: "crm" }).waitFor();
      expect(await page.locator('[data-ui-plugin="test.tabs"]').getByText("PROD").count()).toBe(3);
      expect(
        await page
          .locator('[data-tab-key="table:sales.orders"] [data-ui-plugin="test.tabs"]')
          .textContent(),
      ).toContain("orders");
      expect(
        await page
          .getByRole("button", { name: "orders schließen" })
          .evaluate((button) => getComputedStyle(button).opacity),
      ).toBe("1");

      await page.locator('tbody tr[data-index="0"] td[data-col="id"]').click();
      await page
        .locator("[data-ui-plugin-toolbar]")
        .getByRole("button", { name: "Markdown" })
        .click();
      await page.getByText("Werkzeuge: 1 Zeilen kopiert").waitFor();
      const copied = await page.evaluate(() =>
        (window as unknown as Demo).__uiPluginDemo.calls
          .filter((call) => call.command.includes("clipboard"))
          .map((call) => JSON.stringify(call.args)),
      );
      expect(copied.join("")).toContain("| 10480 |");

      await page.locator('[data-tab-key="table:crm.tickets"] button').first().click();
      await page.getByRole("tab", { name: "Kanban" }).click();
      const lanes = page.locator('[data-ui-plugin="test.tools"] [data-board-column]');
      await lanes.first().waitFor();
      expect(await lanes.count()).toBe(4);
      expect(await lanes.first().textContent()).toContain("Lieferung unvollständig");

      await page.getByRole("button", { name: "Tab-Gruppen (0)" }).click();
      await page.getByRole("menuitem", { name: "Bestellungen mit Positionen" }).waitFor();
      expect(await page.getByRole("menuitem", { name: "Nur für Marketing" }).count()).toBe(0);
      await page.getByRole("menuitem", { name: "Bestellungen mit Positionen" }).click();
      const master = page.locator("#split-0");
      const detail = page.locator("#split-1");
      await master.locator('tbody tr[data-index="1"] td[data-col="id"]').click();
      await detail.getByText("90049", { exact: true }).waitFor();
      expect(await detail.getByText("90048", { exact: true }).count()).toBe(0);
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("l8db.split-view") ?? "{}")),
      ).not.toHaveProperty("state.groups.shop.1");

      const dataCalls = () =>
        page.evaluate(
          () =>
            (window as unknown as Demo).__uiPluginDemo.calls.filter((call) =>
              /^(fetch_table_rows|count_table_rows|execute_query)/.test(call.command),
            ).length,
        );
      const callsBeforeReload = await dataCalls();
      await page.evaluate(
        (source) => (window as unknown as Demo).__uiPluginDemo.setPlugin("a-status.tsx", source),
        STATUS.replace('default: ""', 'default: "● "'),
      );
      await page.locator('[data-ui-plugin="test.status"]').getByText(/^● /).first().waitFor();
      expect(await dataCalls()).toBe(callsBeforeReload);
      await page.evaluate(() =>
        (window as unknown as Demo).__uiPluginDemo.setPlugin(
          "a-status.tsx",
          'import { definePlugin } from "@l8db/ui";\nexport default definePlugin({ id: "test.status", slots: { grid: { cell: 1 } } });',
        ),
      );
      await page.waitForFunction(() =>
        (window as unknown as Demo).__uiPluginDemo.written[".status.json"]?.includes('"stale"'),
      );
      expect(
        await page.locator('[data-ui-plugin="test.status"]').getByText(/^● /).count(),
      ).toBeGreaterThan(0);

      await navigateInApp(page, "/settings?tab=extensions&setting=ui-plugins");
      const section = page.locator('[data-setting-id="ui-plugins"]');
      await section.waitFor();
      await section.getByText("Fehler · alte Version läuft").waitFor();
      await section.getByText("slots.grid.cell muss eine Funktion sein.").waitFor();
      await section.getByRole("switch", { name: "Tabs aktivieren" }).click();
      await page.waitForFunction(() => document.querySelectorAll("[data-tab-group]").length === 0);
      expect(await page.locator('[data-ui-plugin="test.tabs"]').count()).toBe(0);

      const limit = section.getByRole("article", { name: "Werkzeuge" }).getByLabel("Limit");
      await limit.fill("");
      await limit.pressSequentially("45");
      await limit.blur();
      expect(await limit.inputValue()).toBe("45");
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("l8db.ui-plugins") ?? "{}").state.options["test.tools"]
              .limit,
        ),
      ).toBe(45);

      const card = section.getByRole("article", { name: "Galerie-Test" });
      await card.getByRole("button", { name: "Installieren" }).click();
      await card.getByRole("button", { name: "Installiert" }).waitFor();
      await page.getByText("Galerie-Test installiert und aktiv.").waitFor();
      expect(
        await page.evaluate(() =>
          (window as unknown as Demo).__uiPluginDemo.calls
            .filter((call) => call.command === "ui_plugins_write")
            .map((call) => call.args.name),
        ),
      ).toEqual(["test.gallery.tsx"]);
      await page.waitForFunction(() =>
        (window as unknown as Demo).__uiPluginDemo.written[".status.json"]?.includes(
          '"test.gallery"',
        ),
      );
      expect((await status()).find((plugin) => plugin.id === "test.gallery")?.state).toBe("active");
      await page.evaluate(() =>
        (window as unknown as Demo).__uiPluginDemo.setPlugin("test.gallery.tsx", null),
      );
      await card.getByRole("button", { name: "Installieren" }).waitFor();

      expect(errors).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as Demo).uiPluginViolations)).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "/tmp/l8db-ui-plugins-browser-failure.png" });
      throw error;
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  120000,
);
