import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { seedAiWorkspace } from "./fixtures/ai-workspace";

const enabled = process.env.L8DB_AI_BROWSER ?? process.env.L8DB_PRODUCTION_BROWSER;

const offscreen = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-radix-popper-content-wrapper] > *, [data-morph-popover-portal] > *",
      ),
    ]
      .map((element) => ({
        label: element.getAttribute("aria-label") ?? element.getAttribute("role"),
        rect: element.getBoundingClientRect().toJSON() as DOMRect,
      }))
      .filter(
        ({ rect }) =>
          rect.width > 0 &&
          (rect.top < -1 ||
            rect.left < -1 ||
            rect.bottom > innerHeight + 1 ||
            rect.right > innerWidth + 1),
      ),
  );

test.skipIf(!enabled)(
  "AI popovers and menus stay inside the window with many connections and conversations",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(root, `.${pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(root, "index.html")));
      },
    });
    const browser = await (enabled === "webkit" ? webkit : chromium).launch();
    try {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1024, height: 640 },
        { width: 820, height: 520 },
      ]) {
        const page = await browser.newPage({ viewport });
        await seedAiWorkspace(page);
        await page.addInitScript(() => {
          const raw = localStorage.getItem("l8db.connections");
          if (!raw) return;
          const data = JSON.parse(raw);
          if (data.state.connections.length < 20)
            for (let index = 0; index < 80; index++)
              data.state.connections.push({
                id: `many-${index}`,
                name: `CONN_${index}`,
                kind: "postgres",
                connectionString: `postgresql://reader@localhost/db${index}`,
                sslMode: "disable",
              });
          localStorage.setItem("l8db.connections", JSON.stringify(data));
          if (!localStorage.getItem("l8db.ai"))
            localStorage.setItem(
              "l8db.ai",
              JSON.stringify({
                sessions: Array.from({ length: 40 }, (_, index) => ({
                  id: `session-${index}`,
                  title: `Gespräch ${index}`,
                  profileId: "codex",
                  nativeId: null,
                  cwd: "",
                  messages: [{ id: `m${index}`, role: "user", text: "Hallo" }],
                  connectionIds: ["perf"],
                  connectionId: "perf",
                  updatedAt: 1_000_000 - index,
                })),
              }),
            );
        });
        await page.goto(`http://localhost:${server.port}/`);
        await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
        const panel = page.getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true });
        await panel.getByRole("button", { name: "Kontext", exact: true }).click();
        const last = page.getByText("CONN_79", { exact: true });
        await last.waitFor();
        await page.waitForTimeout(400);
        expect(await offscreen(page)).toEqual([]);
        await last.scrollIntoViewIfNeeded();
        const box = await last.boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= viewport.height).toBe(true);
        await page.keyboard.press("Escape");

        await panel.getByRole("button", { name: "Gesprächsverlauf", exact: true }).click();
        const actions = panel.getByRole("button", { name: /^Actions for / });
        await actions.first().waitFor();
        let target = actions.first();
        for (let index = (await actions.count()) - 1; index >= 0; index--) {
          const rect = await actions.nth(index).boundingBox();
          if (rect && rect.y > 0 && rect.y + rect.height <= viewport.height) {
            target = actions.nth(index);
            break;
          }
        }
        await target.click({ force: true });
        await page.getByText("Umbenennen", { exact: true }).waitFor();
        await page.waitForTimeout(500);
        expect(await offscreen(page)).toEqual([]);
        await page.close();
      }
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);
