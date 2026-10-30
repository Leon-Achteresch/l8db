import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { seedAiWorkspace } from "./fixtures/ai-workspace";

const enabled = process.env.L8DB_AI_BROWSER ?? process.env.L8DB_PRODUCTION_BROWSER;

const storedSessions = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((done) => {
        const request = indexedDB.open("l8db.ai");
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => done("[]");
        request.onsuccess = () => {
          const database = request.result;
          const all = database.transaction("sessions").objectStore("sessions").getAll();
          all.onsuccess = () => {
            database.close();
            done(JSON.stringify(all.result));
          };
        };
      }),
  );

async function waitForStored(page: Page, text: string) {
  const deadline = Date.now() + 20_000;
  while (!(await storedSessions(page)).includes(text)) {
    if (Date.now() > deadline) throw new Error(`${text} wurde nicht in IndexedDB gespeichert`);
    await Bun.sleep(100);
  }
}

test.skipIf(!enabled)(
  "AI chats migrate to IndexedDB and keep saving far beyond the localStorage quota",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(root, `.${pathname}`));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(root, "index.html")), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const browser = await (enabled === "webkit" ? webkit : chromium).launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedAiWorkspace(page);
      await page.addInitScript(() => {
        if (sessionStorage.getItem("legacy-seeded")) return;
        sessionStorage.setItem("legacy-seeded", "1");
        localStorage.setItem(
          "l8db.ai",
          JSON.stringify({
            profiles: [],
            servers: [],
            sessions: [
              {
                id: "legacy-chat",
                title: "Legacy chat",
                profileId: "codex",
                nativeId: null,
                cwd: "/tmp",
                connectionIds: [],
                updatedAt: 5,
                messages: [{ id: "m0", role: "assistant", text: "Legacy answer" }],
              },
            ],
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/`);
      await waitForStored(page, "Legacy answer");
      expect(await page.evaluate(() => localStorage.getItem("l8db.ai"))).not.toContain(
        "Legacy answer",
      );
      await page.evaluate(
        (output) =>
          new Promise<void>((done, fail) => {
            const request = indexedDB.open("l8db.ai");
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction("sessions", "readwrite");
              transaction.objectStore("sessions").put({
                id: "huge-chat",
                title: "Huge chat",
                profileId: "codex",
                nativeId: null,
                cwd: "/tmp",
                connectionIds: [],
                updatedAt: 6,
                messages: Array.from({ length: 20 }, (_, index) => ({
                  id: `m${index}`,
                  role: "assistant",
                  text: `huge ${index}`,
                  rich: Array.from({ length: 80 }, (_, tool) => ({
                    type: "tool",
                    id: `t${tool}`,
                    name: "l8db_ai_search",
                    status: "success",
                    output,
                  })),
                })),
              });
              transaction.oncomplete = () => {
                database.close();
                done();
              };
              transaction.onabort = () => fail(transaction.error);
            };
            request.onerror = () => fail(request.error);
          }),
        "x".repeat(16_000),
      );
      await page.reload();
      await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true });
      await panel.getByLabel("Nachricht an AI").fill("indexeddb-browser-check");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await waitForStored(page, "indexeddb-browser-check");
      const stored = await storedSessions(page);
      expect(stored.length).toBeGreaterThan(25_000_000);
      expect(stored).toContain("Legacy answer");
      expect(await panel.getByText("AI-Daten konnten nicht lokal gespeichert werden").count()).toBe(
        0,
      );
      expect(await page.evaluate(() => localStorage.getItem("l8db.ai") ?? "")).not.toContain(
        "indexeddb-browser-check",
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90_000,
);
