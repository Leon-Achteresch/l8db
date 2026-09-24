import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_COMPARE_BROWSER)(
  "Vergleiche behalten bearbeitete Zielentwürfe beim Tabwechsel und Neuladen",
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
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 2, { rows: 2, columns: 2 });
      await page.addInitScript(() => {
        if (localStorage.getItem("l8db.table-tabs")) return;
        const side = {
          connectionId: "perf",
          database: "l8db_perf",
          schema: "public",
          objectType: "table",
          objectName: "table_0000",
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
                    id: "first",
                    title: "Vergleich table_0000",
                    compare: { left: side, right: side, draft: null, onlyDifferences: false },
                  },
                ],
              },
            },
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/compare`);
      await page.getByRole("button", { name: "Vergleich table_0000", exact: true }).click();
      const modified = page.locator(".merge-draft-editor textarea");
      await modified.waitFor();
      await page.getByText("Definitionen werden geladen…").waitFor({ state: "hidden" });
      expect(await page.getByText("Gemeinsamer Entwurf").isVisible()).toBe(true);
      expect(await page.locator(".merge-reference-change").count()).toBe(0);
      expect(await page.locator("select:visible").count()).toBe(0);
      expect(await page.getByLabel("Vergleichsmodus").count()).toBe(0);
      await page.getByRole("button", { name: "Arbeitsstände", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Arbeitsstände" });
      await drawer.getByLabel("Name des Arbeitsstands").fill("Gespeicherter Vergleich");
      await drawer.getByRole("button", { name: "Speichern", exact: true }).click();
      await drawer
        .getByRole("button", { name: "Gespeicherter Vergleich", exact: false })
        .first()
        .click();
      await drawer.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Arbeitsstände", exact: true }).click();
      await drawer
        .getByRole("button", { name: "Gespeicherter Vergleich entfernen", exact: true })
        .click();
      await drawer.getByText("Noch keine Arbeitsstände gespeichert.").waitFor();
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Vergleichsoptionen" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Nur Unterschiede" }).click();
      await page.getByRole("button", { name: "Vergleichsoptionen" }).click();
      expect(
        await page
          .getByRole("menuitemcheckbox", { name: "Nur Unterschiede" })
          .getAttribute("aria-checked"),
      ).toBe("true");
      await page.getByRole("menuitemcheckbox", { name: "Nur Unterschiede" }).press("Escape");
      await page
        .getByRole("menuitemcheckbox", { name: "Nur Unterschiede" })
        .waitFor({ state: "hidden" });
      await page.locator(".merge-draft-editor .view-lines").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("SELECT 'Entwurf bleibt';");
      await page.waitForFunction(() =>
        document
          .querySelector(".merge-draft-editor .view-lines")
          ?.textContent?.replace(/\s/g, " ")
          .includes("Entwurf bleibt"),
      );
      await page
        .getByRole("button", { name: "Änderung aus dem Ziel in den Entwurf übernehmen" })
        .first()
        .click();
      await page.waitForFunction(() =>
        document.querySelector(".merge-draft-editor .view-lines")?.textContent?.includes("COLUMNS"),
      );
      await page.locator(".merge-draft-editor .view-lines").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("SELECT 'Entwurf bleibt';");
      expect(await page.getByRole("button", { name: "Quelle prüfen" }).isEnabled()).toBe(true);
      await page.getByRole("button", { name: "Neuer Vergleich", exact: true }).last().click();
      await page.getByRole("button", { name: "Vergleich table_0000", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".merge-draft-editor .view-lines")
          ?.textContent?.replace(/\s/g, " ")
          .includes("Entwurf bleibt"),
      );
      await page.waitForFunction(() =>
        localStorage.getItem("l8db.table-tabs")?.includes("Entwurf bleibt"),
      );
      await page.reload();
      await modified.waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector(".merge-draft-editor .view-lines")
          ?.textContent?.replace(/\s/g, " ")
          .includes("Entwurf bleibt"),
      );
      await page.evaluate(() => {
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          compareProbe: { commands: string[]; fail: boolean; stale: boolean; committed: boolean };
        };
        const invoke = host.__TAURI_INTERNALS__.invoke;
        host.compareProbe = { commands: [], fail: true, stale: false, committed: false };
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          const probe = host.compareProbe;
          if (
            [
              "begin_transaction",
              "execute_in_transaction",
              "commit_transaction",
              "rollback_transaction",
            ].includes(command)
          )
            probe.commands.push(command);
          if (command === "begin_transaction") return "compare-test-tx";
          if (command === "execute_in_transaction") {
            if (probe.fail) throw new Error("Test: ungültige Definition");
            return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
          }
          if (command === "commit_transaction") {
            probe.committed = true;
            return null;
          }
          if (command === "rollback_transaction") return null;
          const result = await invoke(command, args);
          if (command === "list_table_columns_detailed" && (probe.stale || probe.committed))
            return [
              ...(result as unknown[]),
              {
                name: probe.stale ? "external_change" : "email",
                data_type: "text",
                is_nullable: true,
                column_default: null,
                is_primary_key: false,
                ordinal_position: 3,
                character_maximum_length: null,
              },
            ];
          return result;
        };
      });
      await page.locator(".merge-draft-editor .view-lines").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(
        "TABLE public.table_0000\nCOLUMNS\n  id integer NOT NULL PRIMARY KEY\n  col_1 numeric NULL\n  email text NULL",
      );
      await page.getByRole("button", { name: "Ziel prüfen", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").innerText()).toContain("ungültige Definition");
      expect(await page.getByRole("button", { name: "Bestätigen und ausführen" }).isEnabled()).toBe(
        false,
      );
      expect(await page.evaluate(() => (window as any).compareProbe.commands)).toEqual([
        "begin_transaction",
        "execute_in_transaction",
        "rollback_transaction",
      ]);
      await page.evaluate(() => {
        (window as any).compareProbe.fail = false;
      });
      await page.getByRole("button", { name: "Erneut prüfen" }).click();
      await page.getByText("Prüfung erfolgreich. Bereit zur Bestätigung.").waitFor();
      expect(await page.evaluate(() => (window as any).compareProbe.committed)).toBe(false);
      await page.evaluate(() => {
        (window as any).compareProbe.stale = true;
      });
      await page.getByRole("button", { name: "Bestätigen und ausführen" }).click();
      await page.getByRole("alert").filter({ hasText: "inzwischen verändert" }).waitFor();
      expect(await page.evaluate(() => (window as any).compareProbe.committed)).toBe(false);
      await page.evaluate(() => {
        (window as any).compareProbe.stale = false;
      });
      await page.getByRole("button", { name: "Erneut prüfen" }).click();
      await page.getByText("Prüfung erfolgreich. Bereit zur Bestätigung.").waitFor();
      await page.getByRole("button", { name: "Bestätigen und ausführen" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(
        await page.evaluate(() =>
          (window as any).compareProbe.commands.filter(
            (command: string) => command === "commit_transaction",
          ),
        ),
      ).toHaveLength(1);
      await page.waitForFunction(() =>
        document.querySelector(".merge-draft-editor .view-lines")?.textContent?.includes("email"),
      );
      expect(errors).toEqual([]);
    } finally {
      await saveBrowserArtifacts(browser, "compare");
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);
