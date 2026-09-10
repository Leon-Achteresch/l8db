import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const database = "0";
const provider = process.env.L8DB_REDIS_VARIANT === "valkey" ? "valkey" : "redis";

test.skipIf(!process.env.L8DB_REDIS_BROWSER)(
  "Redis: real adapter, keys, pattern, CRUD, editor and database switching",
  async () => {
    const seed = async (database: string, sql: string) => {
      const response = await fetch("http://127.0.0.1:6382", {
        method: "POST",
        headers: { Origin: "http://localhost:1420" },
        body: JSON.stringify({ command: "execute_query", args: { database, sql } }),
      });
      const result = await response.json();
      if (result.error) throw Error(result.error);
      return result.result;
    };
    await seed(
      "0",
      'FLUSHDB\nSET demo:string "Hallo Redis"\nHSET demo:hash name Ada role admin\nRPUSH demo:list first second\nSADD demo:set red blue\nZADD demo:zset 1 first 2 second\nXADD demo:stream 1-0 event created',
    );
    await seed("1", 'FLUSHDB\nSET other:database "Datenbank 1"');
    const browser = await (process.env.L8DB_REDIS_WEBKIT ? webkit : chromium).launch({
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ database, provider }) => {
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ state: { tourFinished: true }, version: 0 }),
        );
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            state: {
              connections: [
                {
                  id: "redis-lab",
                  name: `${provider} Docker Lab`,
                  kind: "redis",
                  connectionString: `${provider}://127.0.0.1:6381${database === "0" ? "" : `/${database}`}`,
                  sslMode: "disable",
                  ssh: null,
                  schemas: ["keys"],
                },
              ],
              activeId: "redis-lab",
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          "l8db.db-selection",
          JSON.stringify({
            state: { databaseByConnection: {}, schemaByConnection: { "redis-lab": "public" } },
            version: 0,
          }),
        );
        const host = window as unknown as { __TAURI_INTERNALS__: unknown; redisCalls: unknown[] };
        host.redisCalls = [];
        host.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command.endsWith("secret")) return null;
            if (
              command.startsWith("plugin:") ||
              command.includes("extension") ||
              command === "list_ssh_tunnels"
            )
              return [];
            host.redisCalls.push({ command, args });
            const response = await fetch("http://127.0.0.1:6382", {
              method: "POST",
              body: JSON.stringify({ command, args }),
            });
            const value = await response.json();
            if (value.error) throw Error(value.error);
            return value.result;
          },
        };
      },
      { database, provider },
    );
    try {
      await page.goto("http://localhost:1420");
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).waitFor();
      await page.locator('[data-tour="sidebar-table"]').filter({ hasText: "keys" }).first().click();
      await page.getByText("demo:string", { exact: true }).first().waitFor();
      expect(await page.getByRole("combobox", { name: "Schema", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const pattern = page.getByRole("textbox", { name: "Redis-Key-Pattern", exact: true });
      await pattern.fill("demo:hash");
      await page.getByRole("button", { name: "Filter anwenden", exact: true }).click();
      await page.getByText("1–1 von 1", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/l8db-redis-filter.png" });
      await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
      await page.getByText("demo:string", { exact: true }).first().waitFor();
      const rowFor = (key: string) =>
        page
          .locator("tr[data-ctid]")
          .filter({ has: page.locator('[data-col="key"]', { hasText: key }) });
      const edit = async (key: string, column: string, value: string) => {
        const row = rowFor(key);
        await row.locator(`[data-col="${column}"]`).dblclick();
        const input = page.locator("tr[data-ctid] input");
        await input.fill(value);
        await input.press("Enter");
        await input.waitFor({ state: "detached" });
      };
      await edit("demo:string", "ttl", "600");
      await edit("demo:string", "value", 'Valkey geändert "direkt"');
      let stored = await seed("0", "GET demo:string\nTTL demo:string");
      expect(stored.rows[0].result).toBe('Valkey geändert "direkt"');
      expect(stored.rows[1].result).toBeGreaterThan(500);
      await edit("demo:string", "value", "");
      stored = await seed("0", "GET demo:string");
      expect(stored.rows[0].result).toBe("");
      await rowFor("demo:string").locator('[data-col="value"]').click();
      await rowFor("demo:string").getByTitle("Anzeigen / bearbeiten").click();
      const cellDialog = page.getByRole("dialog");
      await cellDialog.getByRole("button", { name: "Bearbeiten", exact: true }).click();
      await cellDialog.locator("textarea").fill("mehrzeilig\nkein JSON");
      await cellDialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await cellDialog.waitFor({ state: "detached" });
      expect((await seed("0", "GET demo:string")).rows[0].result).toBe("mehrzeilig\nkein JSON");
      await edit("demo:string", "value", "Hallo Redis");
      await edit("demo:string", "ttl", "");
      expect((await seed("0", "TTL demo:string")).rows[0].result).toBe(-1);
      await edit("demo:string", "key", "demo:renamed");
      expect(
        (await seed("0", "EXISTS demo:string\nGET demo:renamed")).rows.map(
          (r: { result: unknown }) => r.result,
        ),
      ).toEqual([0, "Hallo Redis"]);
      await edit("demo:renamed", "key", "demo:string");
      await rowFor("demo:string").locator('[data-col="key"]').dblclick();
      await page.locator("tr[data-ctid] input").fill("demo:hash");
      await page.locator("tr[data-ctid] input").press("Enter");
      await page.getByText(/Der Ziel-Key existiert bereits/).waitFor();
      expect(
        (await seed("0", "TYPE demo:hash\nGET demo:string")).rows.map(
          (r: { result: unknown }) => r.result,
        ),
      ).toEqual(["hash", "Hallo Redis"]);
      await page.locator("tr[data-ctid] input").press("Escape");
      await rowFor("demo:string").locator('[data-col="value"]').dblclick();
      await page.locator("tr[data-ctid] input").fill("veralteter Entwurf");
      await seed("0", "SET demo:string extern");
      await page.locator("tr[data-ctid] input").press("Enter");
      await page.getByText(/Wert wurde zwischenzeitlich geändert/).waitFor();
      expect((await seed("0", "GET demo:string")).rows[0].result).toBe("extern");
      await page.locator("tr[data-ctid] input").press("Escape");
      await seed("0", 'SET demo:string "Hallo Redis"');
      await rowFor("demo:hash").locator('[data-col="type"]').dblclick();
      expect(await rowFor("demo:hash").locator("input").count()).toBe(0);
      await page.locator('th[data-column-id="key"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "Filter setzen…", exact: true }).click();
      await page.getByPlaceholder("Wert", { exact: true }).fill("demo:hash");
      await page.getByPlaceholder("Wert", { exact: true }).press("Enter");
      await page.getByText("1–1 von 1", { exact: true }).waitFor();
      expect(await page.locator('td[data-col="key"]').allTextContents()).toEqual(["demo:hash"]);
      await seed("0", 'SET " literal:*?[x] " exact\nSET literal:other decoy');
      await page.locator('th[data-column-id="key"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "Filter setzen…", exact: true }).click();
      await page.getByPlaceholder("Wert", { exact: true }).fill(" literal:*?[x] ");
      await page.getByPlaceholder("Wert", { exact: true }).press("Enter");
      await page.getByText(" literal:*?[x] ", { exact: true }).first().waitFor();
      expect(await page.locator('td[data-col="key"]').allTextContents()).toEqual([
        " literal:*?[x] ",
      ]);
      await page.screenshot({ path: `/tmp/l8db-${provider}-column-filter.png` });
      await seed("0", 'DEL " literal:*?[x] " literal:other');
      await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
      await page.getByRole("button", { name: "Key verwalten", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("browser:key");
      const choose = async (label: string) => {
        await dialog.getByRole("combobox").click();
        await page.getByRole("option", { name: label, exact: true }).click();
      };
      const run = async () => {
        await dialog.getByRole("button", { name: "Ausführen", exact: true }).click();
        await dialog.getByRole("region", { name: "Redis-Ergebnis" }).waitFor();
        await dialog.getByRole("button", { name: "Ausführen", exact: true }).waitFor();
        expect(await dialog.getByRole("alert").count()).toBe(0);
      };
      await choose("String setzen");
      await dialog
        .getByRole("textbox", { name: "Wert", exact: true })
        .fill('Grüße "Redis"\nzweite Zeile');
      await run();
      await choose("Lesen");
      await run();
      expect(await dialog.getByRole("region", { name: "Redis-Ergebnis" }).innerText()).toContain(
        "Grüße",
      );
      await choose("Ablaufzeit setzen");
      await dialog.getByRole("textbox", { name: "TTL (Sekunden)", exact: true }).fill("600");
      await run();
      await choose("Ablaufzeit entfernen");
      await run();
      await choose("Umbenennen");
      await dialog.getByRole("textbox", { name: "Neuer Key", exact: true }).fill("browser:renamed");
      await run();
      await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("browser:renamed");
      await choose("Key löschen");
      await dialog.getByRole("button", { name: "Key endgültig löschen", exact: true }).click();
      await dialog.getByRole("region", { name: "Redis-Ergebnis" }).waitFor();
      await page.screenshot({ path: "/tmp/l8db-redis-key-actions.png" });
      for (const [action, key, field, value] of [
        ["Hash-Feld setzen", "browser:hash", "name", "Ada"],
        ["An Liste anhängen", "browser:list", "", "first"],
        ["Set-Mitglied hinzufügen", "browser:set", "", "member"],
        ["Sorted-Set-Mitglied setzen", "browser:zset", "2.5", "ranked"],
        ["Stream-Eintrag hinzufügen", "browser:stream", "event", "created"],
      ]) {
        await dialog.getByRole("textbox", { name: "Key", exact: true }).fill(key);
        await choose(action);
        if (field)
          await dialog
            .getByRole("textbox", {
              name: action === "Sorted-Set-Mitglied setzen" ? "Score" : "Feld",
              exact: true,
            })
            .fill(field);
        await dialog.getByRole("textbox", { name: "Wert", exact: true }).fill(value);
        await run();
        await choose("Lesen");
        await run();
        expect(await dialog.getByRole("region", { name: "Redis-Ergebnis" }).innerText()).toContain(
          value,
        );
      }
      await page.keyboard.press("Escape");
      await page.getByText("browser:hash", { exact: true }).first().waitFor();
      await page.locator('[data-tour="sidebar-table"]').first().click({ button: "right" });
      expect(await page.getByRole("menuitem", { name: "Drop Table", exact: true }).count()).toBe(0);
      await page.getByRole("menuitem", { name: "Im Editor öffnen", exact: true }).click();
      await page.getByRole("button", { name: "Ausführen", exact: true }).click();
      await page.getByText("SCAN 0 MATCH * COUNT 100", { exact: true }).first().waitFor();
      expect(await page.getByRole("dialog").count()).toBe(0);
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type('SET browser:editor "value; spaced"');
      await page.keyboard.press("Enter");
      await page.keyboard.type("GET browser:editor");
      await page.getByRole("button", { name: "Ausführen", exact: true }).click();
      await page.getByText("value; spaced", { exact: true }).first().waitFor({ timeout: 5000 });
      expect(await page.getByRole("dialog").count()).toBe(0);
      await page.screenshot({ path: "/tmp/l8db-redis-query.png" });
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).click();
      await page.getByRole("option", { name: "1", exact: true }).click();
      await page.locator('[data-tour="sidebar-table"]').first().click();
      await page.getByText("other:database", { exact: true }).first().waitFor();
      await page.locator('[data-tour="sidebar-table"]').first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Alle Keys löschen", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByText(/FLUSHDB/)
        .waitFor();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete All", exact: true })
        .click();
      await page.getByText("Keine Daten.", { exact: false }).first().waitFor();
      await page.goto("http://localhost:1420/connections");
      await page.getByRole("button", { name: "Neu", exact: true }).click();
      await page
        .getByRole("radiogroup", { name: "Erstellungsmodus" })
        .getByText("Connection-String", { exact: true })
        .click();
      await page.getByLabel("Name", { exact: true }).fill("Redis Connection Test");
      await page.locator("#quick-connection-url").fill(`${provider}://127.0.0.1:6381/0`);
      await page.getByRole("button", { name: "Testen", exact: true }).click();
      await page.getByText(/Erreichbar/).waitFor();
      await page.locator("#quick-connection-url").fill(`${provider}://127.0.0.1:6381/9999`);
      await page.getByRole("button", { name: "Testen", exact: true }).click();
      await page.getByRole("alert").first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-redis-connection.png" });
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "/tmp/l8db-redis-browser-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  120_000,
);
