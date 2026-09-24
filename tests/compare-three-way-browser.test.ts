import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_COMPARE_BROWSER)(
  "ein gemeinsamer View-Entwurf wird getrennt in Quelle und Ziel übernommen",
  async () => {
    const root = resolve("dist");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = resolve(root, `.${new URL(request.url).pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        return new Response(
          path !== root && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
        );
      },
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await seedApp(page, 2, { rows: 2, columns: 2 });
      await page.addInitScript(() => {
        const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
        stored.state.connections.push({
          id: "target",
          name: "target",
          kind: "postgres",
          connectionString: "postgresql://leon@localhost:5432/l8db_target",
          sslMode: "disable",
        });
        localStorage.setItem("l8db.connections", JSON.stringify(stored));
        const left = {
          connectionId: "perf",
          database: "l8db_perf",
          schema: "public",
          objectType: "view",
          objectName: "v_table_0000",
          objectOid: null,
        };
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                perf: [
                  {
                    kind: "tool",
                    tool: "compare",
                    id: "three",
                    title: "Vergleich v_table_0000",
                    compare: {
                      left,
                      right: { ...left, connectionId: "target", database: "l8db_target" },
                      draft: null,
                      onlyDifferences: false,
                    },
                  },
                ],
              },
            },
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          threeWayProbe: { definitions: Record<string, string> };
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        const definitions = {
          source: "SELECT id, left_flag FROM items",
          target: "SELECT id, right_flag FROM items",
        };
        host.threeWayProbe = { definitions };
        const pending = new Map<string, string>();
        let nextId = 0;
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          const side = String(args?.connectionString ?? "").includes("l8db_target")
            ? "target"
            : "source";
          if (command === "get_view_definition") return definitions[side];
          if (command === "begin_transaction") return `${side}-${++nextId}`;
          if (command === "execute_in_transaction") {
            pending.set(String(args?.txId), String(args?.sql));
            return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
          }
          if (command === "rollback_transaction") {
            pending.delete(String(args?.txId));
            return null;
          }
          if (command === "commit_transaction") {
            const txId = String(args?.txId);
            const sql = pending.get(txId) ?? "";
            const key = txId.startsWith("target") ? "target" : "source";
            definitions[key] = sql.slice(sql.indexOf(" AS ") + 4);
            pending.delete(txId);
            return null;
          }
          return original(command, args);
        };
      });
      await page.goto(`http://localhost:${server.port}/compare`);
      await page.getByRole("button", { name: "Vergleich v_table_0000", exact: true }).click();
      await page.getByText("Definitionen werden geladen…").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Quelle in Entwurf übernehmen" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".merge-draft-editor .view-lines")
          ?.textContent?.includes("left_flag"),
      );
      expect(await page.locator(".merge-draft-editor .view-lines").innerText()).not.toContain(
        "right_flag",
      );
      await page.getByRole("button", { name: "Ziel in Entwurf übernehmen" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".merge-draft-editor .view-lines")
          ?.textContent?.includes("right_flag"),
      );
      expect(await page.locator(".merge-draft-editor .view-lines").innerText()).not.toContain(
        "left_flag",
      );
      await page.locator(".merge-draft-editor .view-lines").click();
      await page.keyboard.press("ControlOrMeta+a");
      const merged = "SELECT id, left_flag, right_flag FROM items";
      await page.keyboard.insertText(merged);
      await page.getByRole("button", { name: "Quelle prüfen" }).click();
      await page.getByText("Prüfung erfolgreich. Bereit zur Bestätigung.").waitFor();
      await page.getByRole("button", { name: "Bestätigen und ausführen" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Ziel prüfen" }).click();
      await page.getByText("Prüfung erfolgreich. Bereit zur Bestätigung.").waitFor();
      await page.getByRole("button", { name: "Bestätigen und ausführen" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(() => {
        const probe = (
          window as unknown as { threeWayProbe: { definitions: Record<string, string> } }
        ).threeWayProbe;
        return probe.definitions.source === probe.definitions.target;
      });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { threeWayProbe: { definitions: Record<string, string> } })
              .threeWayProbe.definitions,
        ),
      ).toEqual({ source: merged, target: merged });
      expect(await page.getByRole("button", { name: "Quelle prüfen" }).isDisabled()).toBe(true);
      expect(await page.getByRole("button", { name: "Ziel prüfen" }).isDisabled()).toBe(true);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);
