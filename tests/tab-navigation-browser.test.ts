import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

for (const intent of ["focus", "hover"] as const) {
  test.skipIf(!process.env.L8DB_TAB_BROWSER)(
    `tabs preload on ${intent}, respond while loading and recover after rapid navigation`,
    async () => {
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
          return new Response(
            pathname !== "/" && (await file.exists()) ? file : Bun.file("dist/index.html"),
          );
        },
      });
      const engine = process.env.L8DB_TAB_BROWSER === "webkit" ? webkit : chromium;
      const browser = await engine.launch({ headless: true });
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await seedApp(page, 5, { rows: 20, columns: 4 });
        await page.addInitScript(() => {
          const tabs = [
            { kind: "table", schema: "public", table: "table_0000" },
            { kind: "table", schema: "public", table: "table_0001" },
            { kind: "query", id: "latency", title: "Latency", sql: "select 1" },
          ];
          localStorage.setItem(
            "l8db.table-tabs",
            JSON.stringify({
              version: 4,
              state: { tabsByConnection: { perf: tabs } },
            }),
          );
        });
        await page.route("**/assets/query-view-*.js", async (route) => {
          await gate;
          await route.continue();
        });
        await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
        await page.locator("tbody tr[data-index]").first().waitFor();
        const query = page.locator('[data-tab-key="query:latency"] button[title]');
        const table = page.locator('[data-tab-key="table:public.table_0000"] button[title]');
        await page.waitForFunction(() =>
          document.querySelector('[data-tab-key="table:public.table_0000"] [aria-current="page"]'),
        );
        const preload = page.waitForRequest(/\/assets\/query-view-.*\.js/, { timeout: 10000 });
        await query[intent]();
        await preload;
        expect(await table.getAttribute("aria-current")).toBe("page");
        await query.press("Enter");
        await page
          .getByRole("status")
          .filter({ hasText: "wird geöffnet" })
          .waitFor({ timeout: 500 });
        expect(await query.getAttribute("aria-current")).toBe("page");
        expect(await query.getAttribute("aria-busy")).toBe("true");
        expect(
          await page.locator("tbody").evaluate((element) => Boolean(element.closest("[inert]"))),
        ).toBe(true);
        await table.click();
        await page
          .getByRole("status")
          .filter({ hasText: "wird geöffnet" })
          .waitFor({ state: "hidden", timeout: 1000 });
        expect(await table.getAttribute("aria-current")).toBe("page");
        release();
        await query.click();
        await page.locator('[data-tour="query-toolbar"]').waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-tab-key="query:latency"] [aria-busy="true"]'),
        );
        await table.click();
        await page.locator("tbody tr[data-index]").first().waitFor();
        expect(await table.getAttribute("aria-current")).toBe("page");
        expect(errors).toEqual([]);
      } finally {
        release();
        await browser.close();
        server.stop(true);
      }
    },
    60000,
  );
}

test.skipIf(!process.env.L8DB_TAB_BROWSER)(
  "switching tabs re-renders only the affected tabs and skips unchanged store writes",
  async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
        return new Response(
          pathname !== "/" && (await file.exists()) ? file : Bun.file("dist/index.html"),
        );
      },
    });
    const engine = process.env.L8DB_TAB_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 30, { rows: 20, columns: 4 });
      await page.addInitScript(() => {
        const tabs = Array.from({ length: 20 }, (_, i) => ({
          kind: "table",
          schema: "public",
          table: `table_${String(i).padStart(4, "0")}`,
        }));
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({ version: 4, state: { tabsByConnection: { perf: tabs } } }),
        );
        type Fiber = {
          tag: number;
          flags: number;
          child: Fiber | null;
          sibling: Fiber | null;
          alternate: Fiber | null;
          stateNode: unknown;
        };
        const probe = { counting: false, tabBarRenders: 0, writes: [] as string[] };
        Object.assign(window, { __probe: probe });
        const walk = (next: Fiber, prev: Fiber | null, inBar: boolean) => {
          const bar =
            inBar ||
            (next.tag === 5 &&
              next.stateNode instanceof Element &&
              next.stateNode.matches('nav[aria-label="Geöffnete Objekte"]'));
          if (bar && [0, 1, 11, 14, 15].includes(next.tag) && (!prev || next.flags & 1))
            probe.tabBarRenders++;
          if (prev && next.child === prev.child) return;
          for (let child = next.child; child; child = child.sibling)
            walk(child, prev ? child.alternate : null, bar);
        };
        Object.assign(window, {
          __REACT_DEVTOOLS_GLOBAL_HOOK__: {
            supportsFiber: true,
            renderers: new Map(),
            inject: () => 1,
            onScheduleFiberRoot: () => {},
            onCommitFiberRoot: (_: number, root: { current: Fiber }) => {
              if (probe.counting) walk(root.current, root.current.alternate, false);
            },
            onCommitFiberUnmount: () => {},
            onPostCommitFiberRoot: () => {},
            checkDCE: () => {},
          },
        });
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (probe.counting) probe.writes.push(key);
          return setItem.call(this, key, value);
        };
      });
      await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
      await page.locator("tbody tr[data-index]").first().waitFor();
      await page.waitForTimeout(500);
      const switches = 10;
      for (let i = 1; i <= switches + 1; i++) {
        if (i === 2)
          await page.evaluate(() => {
            (window as unknown as { __probe: { counting: boolean } }).__probe.counting = true;
          });
        const tab = page.locator(
          `[data-tab-key="table:public.table_${String(i).padStart(4, "0")}"] button[title]`,
        );
        await tab.click();
        await page.waitForFunction(
          (key) =>
            document
              .querySelector(`[data-tab-key="${key}"] button[title]`)
              ?.getAttribute("aria-current") === "page" &&
            !document.querySelector('[aria-busy="true"]'),
          `table:public.table_${String(i).padStart(4, "0")}`,
        );
        await page.locator("tbody tr[data-index]").first().waitFor();
      }
      await page.waitForTimeout(400);
      const probe = await page.evaluate(
        () =>
          (window as unknown as { __probe: { tabBarRenders: number; writes: string[] } }).__probe,
      );
      console.log(
        `tab bar: ${(probe.tabBarRenders / switches).toFixed(0)} component renders per switch`,
      );
      expect(probe.tabBarRenders / switches).toBeLessThan(400);
      expect(
        probe.writes.filter((key) =>
          ["l8db.table-tabs", "l8db.split-view", "l8db.master-detail"].includes(key),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
