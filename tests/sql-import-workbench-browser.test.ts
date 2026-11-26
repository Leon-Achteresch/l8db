import { expect, test } from "bun:test";
import { chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestsSince,
} from "./fixtures/perf-app-requests";

const appUrl = process.env.L8DB_SQL_IMPORT_BROWSER_URL;
const large = Array.from({ length: 12000 }, (_, i) => `SELECT ${i} AS probe FROM dual;`).join("\n");

interface FilePicker {
  path: string | null;
  sql: string;
  hold: boolean;
  release?: () => void;
}

declare global {
  interface Window {
    sqlImportFixture: FilePicker;
    firstStatementCopies: number;
    sqlRunFixture: { hold: boolean; fail: boolean; calls: number; release?: () => void };
    scriptResultProbe: { calls: number; clipboard: string };
  }
}

async function seedSqlImport(page: Page) {
  await seedApp(page, 1);
  await page.addInitScript((sql) => {
    const key = "l8db.connections";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(saved.state.connections[0], {
      kind: "oracle",
      connectionString: "oracle://test@localhost/XE",
    });
    localStorage.setItem(key, JSON.stringify(saved));
    const fixture: FilePicker = { path: "/fixture/large.sql", sql, hold: false };
    window.sqlImportFixture = fixture;
    const tauri = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: { path?: string }): Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = tauri.invoke;
    tauri.invoke = async (command, args) => {
      if (command === "plugin:dialog|open") return fixture.path;
      if (command === "plugin:fs|stat" && args?.path?.startsWith("/fixture/"))
        return { size: fixture.sql.length };
      if (command === "plugin:fs|read_file" && args?.path?.startsWith("/fixture/")) {
        const content = new TextEncoder().encode(fixture.sql);
        if (fixture.hold)
          await new Promise<void>((resolve) => {
            fixture.release = resolve;
          });
        return content.buffer;
      }
      return invoke(command, args);
    };
  }, large);
  await installAppRequestProbe(page);
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!appUrl)(
    `${engine.name()}: filter script issues, select the original statement and copy every page`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        await seedSqlImport(page);
        await page.addInitScript(() => {
          const probe = { calls: 0, clipboard: "" };
          window.scriptResultProbe = probe;
          const tauri = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke(command: string, args?: { text?: string; sql?: string }): Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          const invoke = tauri.invoke;
          tauri.invoke = async (command, args) => {
            if (command === "plugin:clipboard-manager|write_text") {
              probe.clipboard = args?.text ?? "";
              return;
            }
            const sql = args?.sql ?? "";
            if (command !== "execute_query" || !sql.includes("page_probe"))
              return invoke(command, args);
            probe.calls++;
            if (sql.includes("CREATE VIEW")) throw new Error("ORA-24344: compilation warning");
            if (sql.includes("SELECT 125 ")) throw new Error("Erwarteter Lesefehler");
            return {
              columns: ["page_probe"],
              rows: [{ page_probe: 1 }],
              rows_affected: null,
              execution_time_ms: 1,
            };
          };
        });
        await page.goto(`${appUrl}/import`);
        await page.evaluate(() => {
          window.sqlImportFixture.sql = Array.from({ length: 127 }, (_, i) =>
            i === 75
              ? "CREATE VIEW page_probe AS SELECT 75 AS n FROM dual;"
              : `SELECT ${i} AS page_probe FROM dual;`,
          ).join("\n");
        });
        await page.getByRole("button", { name: /Datei auswählen/ }).click();
        const mode = page.locator("#sql-import-mode");
        if (!(await mode.innerText()).includes("Autocommit")) {
          await mode.click();
          await page.getByRole("option", { name: "Autocommit je Statement" }).click();
        }
        const stop = page.getByRole("switch", { name: "Bei Fehler stoppen" });
        if (await stop.isChecked()) await stop.click();
        await page.getByRole("button", { name: "Ausführen", exact: true }).click();
        await page
          .getByText("125/127 erfolgreich · 1 fehlgeschlagen · 1 mit Warnung", { exact: true })
          .waitFor();
        const viewport = page.getByRole("region", { name: "Statement-Ergebnisse" });
        const rows = viewport.getByRole("button").filter({ hasText: "page_probe" });
        expect(await rows.count()).toBe(50);
        const previous = page.getByRole("button", { name: "Vorherige Statements" });
        const next = page.getByRole("button", { name: "Nächste Statements" });
        expect(await previous.isDisabled()).toBe(true);
        await next.click();
        await page.getByText("51–100 von 127").waitFor();
        await page.getByRole("button", { name: "Letzte Statements" }).click();
        await page.getByText("101–127 von 127").waitFor();
        expect(await next.isDisabled()).toBe(true);
        expect(await rows.count()).toBe(27);
        await page.getByRole("button", { name: "Erste Statements" }).click();
        const filter = page.getByRole("button", { name: /Nur Fehler und Warnungen/ });
        await filter.focus();
        await filter.press("Enter");
        expect(await filter.getAttribute("aria-pressed")).toBe("true");
        expect(await rows.count()).toBe(2);
        await page.getByRole("button", { name: /76 Warnung CREATE VIEW page_probe/ }).waitFor();
        const failure = page.getByRole("button", { name: /126 Fehler SELECT 125 AS page_probe/ });
        await failure.click();
        expect(await failure.getAttribute("aria-pressed")).toBe("true");
        await page.getByRole("button", { name: "Skriptprotokoll kopieren" }).click();
        const copied = await page.evaluate(() => window.scriptResultProbe.clipboard);
        expect(copied.match(/^SQL> /gm)).toHaveLength(127);
        expect(copied).toContain("SQL> SELECT 0 AS page_probe");
        expect(copied).toContain("SQL> SELECT 126 AS page_probe");
        await filter.click();
        await page.getByText("101–127 von 127").waitFor();
        expect(await failure.getAttribute("aria-pressed")).toBe("true");
        const rowBox = await failure.boundingBox();
        const listBox = await viewport.boundingBox();
        expect(
          rowBox &&
            listBox &&
            rowBox.y >= listBox.y - 1 &&
            rowBox.y + rowBox.height <= listBox.y + listBox.height + 1,
        ).toBe(true);
        expect(await page.evaluate(() => window.scriptResultProbe.calls)).toBe(127);
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  test.skipIf(!appUrl)(
    `${engine.name()}: replacing a script keeps the previous import's results and errors separate`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        await seedSqlImport(page);
        await page.addInitScript(() => {
          const fixture: Window["sqlRunFixture"] = {
            hold: false,
            fail: false,
            calls: 0,
          };
          window.sqlRunFixture = fixture;
          const tauri = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke(command: string, args?: { sql?: string }): Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          const invoke = tauri.invoke;
          tauri.invoke = async (command, args) => {
            if (command !== "execute_query" || !args?.sql?.includes("import_probe"))
              return invoke(command, args);
            fixture.calls++;
            if (fixture.hold) {
              fixture.hold = false;
              await new Promise<void>((resolve) => {
                fixture.release = resolve;
              });
              if (fixture.fail) throw new Error("Fehler aus dem vorherigen Import");
            }
            return {
              columns: ["import_probe"],
              rows: [{ import_probe: 1 }],
              rows_affected: null,
              execution_time_ms: 1,
            };
          };
        });
        await page.goto(`${appUrl}/import`);
        const choose = page.getByRole("button", { name: /Datei auswählen/ });
        const run = page.getByRole("button", { name: "Ausführen", exact: true });
        for (const sameFile of [false, true]) {
          await page.evaluate((fail) => {
            Object.assign(window.sqlImportFixture, {
              path: "/fixture/source.sql",
              sql: "SELECT 1 AS import_probe;",
            });
            Object.assign(window.sqlRunFixture, { hold: true, fail, release: undefined });
          }, sameFile);
          await choose.click();
          await page.getByText("Skript · 1 Anweisung", { exact: true }).waitFor();
          await run.click();
          await page.waitForFunction(() => !!window.sqlRunFixture.release);
          const calls = await page.evaluate(() => window.sqlRunFixture.calls);
          if (!sameFile)
            await page.evaluate(() =>
              Object.assign(window.sqlImportFixture, {
                path: "/fixture/next.sql",
                sql: "SELECT 2 AS import_probe;",
              }),
            );
          await page.getByRole("button", { name: "Andere Datei…", exact: true }).click();
          const waiting = page.getByRole("button", {
            name: "Import läuft · source.sql",
            exact: true,
          });
          await waiting.waitFor();
          expect(await waiting.isDisabled()).toBe(true);
          expect(
            await page.getByRole("button", { name: "Abbrechen", exact: true }).isEnabled(),
          ).toBe(true);
          expect(
            await page.getByRole("button", { name: "Skriptergebnisse schließen" }).count(),
          ).toBe(0);
          await page.evaluate(() => window.sqlRunFixture.release?.());
          await run.waitFor();
          if (sameFile)
            await page
              .getByText("Fehler aus dem vorherigen Import", { exact: false })
              .last()
              .waitFor();
          expect(await page.locator("p[role=alert]").count()).toBe(0);
          const selected = page.locator("aside button[aria-current=true]");
          expect(await selected.innerText()).toContain(sameFile ? "source.sql" : "next.sql");
          expect(await selected.innerText()).not.toMatch(/Ausgeführt|Fehler|Abgebrochen|Läuft/);
          expect(
            await page.getByRole("button", { name: "Skriptergebnisse schließen" }).count(),
          ).toBe(0);
          expect(await page.evaluate(() => window.sqlRunFixture.calls)).toBe(calls);
          await run.click();
          await page.getByText("1/1 erfolgreich", { exact: true }).waitFor();
          expect(await page.evaluate(() => window.sqlRunFixture.calls)).toBe(calls + 1);
        }
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  test.skipIf(!appUrl)(
    `${engine.name()}: import options reuse parsed statements`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await seedSqlImport(page);
        await page.goto(`${appUrl}/import`);
        const pick = page.getByRole("button", { name: "SQL-Skript wählen…", exact: true });
        await pick.waitFor();
        await page.evaluate(() => {
          const sql = window.sqlImportFixture.sql;
          const endOfFirst = sql.indexOf(";") + 1;
          const slice = String.prototype.slice;
          window.firstStatementCopies = 0;
          String.prototype.slice = function (start, end) {
            if (this.length === sql.length && start === 0 && end === endOfFirst)
              window.firstStatementCopies++;
            return slice.call(this, start, end);
          };
        });
        await pick.click();
        await page.getByText("Skript · 12.000 Anweisungen", { exact: true }).waitFor();
        const initial = await page.evaluate(() => window.firstStatementCopies);
        const option = page.getByRole("switch", { name: "Bei Fehler stoppen" });
        for (let i = 0; i < 8; i++) await option.click();
        const after = await page.evaluate(() => window.firstStatementCopies);
        console.log(engine.name(), "first statement copies", {
          initial,
          additional: after - initial,
        });
        expect(initial).toBeLessThanOrEqual(1);
        expect(after).toBe(initial);
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  test.skipIf(!appUrl)(
    `${engine.name()}: SQL file selection, cached preview and Oracle commands`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        await seedSqlImport(page);
        await page.goto(`${appUrl}/import`);
        const pick = page.getByRole("button", { name: "SQL-Skript wählen…", exact: true });
        const replace = page.getByRole("button", { name: "Andere Datei…", exact: true });
        const run = page.getByRole("button", { name: "Ausführen", exact: true });
        await pick.waitFor();
        const before = await appRequestSnapshot(page);
        await pick.click();
        await page.getByText("Skript · 12.000 Anweisungen", { exact: true }).waitFor();
        expect(await page.getByText("12.000 Anweisungen", { exact: true }).isVisible()).toBe(true);
        expect(
          await page
            .locator("dd")
            .getByText("Autocommit je Statement", { exact: true })
            .isVisible(),
        ).toBe(true);
        const loaded = await appRequestSnapshot(page);
        const reads = (calls: string[]) =>
          calls.filter((cmd) => cmd === "plugin:fs|stat" || cmd === "plugin:fs|read_file");
        expect(reads(loaded.calls.slice(before.calls.length))).toEqual([
          "plugin:fs|stat",
          "plugin:fs|read_file",
        ]);
        const switcher = page.getByRole("switch", { name: "Bei Fehler stoppen" });
        const samples: number[] = [];
        for (let i = 0; i < 22; i++) {
          const duration = await switcher.evaluate(async (el) => {
            const initial = el.getAttribute("aria-checked");
            const start = performance.now();
            (el as HTMLButtonElement).click();
            await new Promise(requestAnimationFrame);
            if (el.getAttribute("aria-checked") === initial)
              throw new Error("Option blieb unverändert");
            return performance.now() - start;
          });
          if (i) samples.push(duration);
        }
        const { medianMs, p95Ms } = interactionPercentiles(samples);
        console.log(engine.name(), "12,000 SQL statements", { medianMs, p95Ms });
        expect(medianMs).toBeLessThan(35);
        expect(p95Ms).toBeLessThan(100);
        expect(await page.locator("pre").evaluate((el) => el.childNodes.length)).toBe(1);
        const options = await appRequestSnapshot(page);
        expect(reads(options.calls.slice(loaded.calls.length))).toEqual([]);

        await page.evaluate(() => {
          window.sqlImportFixture.path = null;
        });
        await replace.click();
        expect(
          await page.getByText("Skript · 12.000 Anweisungen", { exact: true }).isVisible(),
        ).toBe(true);
        expect(reads((await appRequestSnapshot(page)).calls.slice(options.calls.length))).toEqual(
          [],
        );

        await page.evaluate(() =>
          Object.assign(window.sqlImportFixture, {
            path: "/fixture/slow.sql",
            sql: "SELECT 99;",
            hold: true,
          }),
        );
        await replace.click();
        await page.waitForFunction(() => Boolean(window.sqlImportFixture.release));
        await page.evaluate(() =>
          Object.assign(window.sqlImportFixture, {
            path: "/fixture/commands.sql",
            sql: "REM Hinweis\nPROMPT Nachricht",
            hold: false,
          }),
        );
        await page.getByRole("button", { name: /Datei auswählen/ }).click();
        await page.getByText("Skript · 1 SQL*Plus-Befehl", { exact: true }).waitFor();
        await page.evaluate(async () => {
          window.sqlImportFixture.release?.();
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        expect(
          await page.getByText("Skript · 1 SQL*Plus-Befehl", { exact: true }).isVisible(),
        ).toBe(true);
        expect(await run.isEnabled()).toBe(true);
        const overlap = await appRequestSnapshot(page);
        expect(reads(overlap.calls.slice(options.calls.length))).toEqual([
          "plugin:fs|stat",
          "plugin:fs|read_file",
          "plugin:fs|stat",
          "plugin:fs|read_file",
        ]);
        expect(requestsSince(before, overlap).databaseRequests).toBe(0);
        await run.click();
        await page.getByText("1/1 erfolgreich", { exact: true }).waitFor();

        await page.evaluate(() =>
          Object.assign(window.sqlImportFixture, { path: "/fixture/empty.sql", sql: "" }),
        );
        await replace.click();
        await page.getByText("Skript · 0 Anweisungen", { exact: true }).waitFor();
        expect(await replace.isEnabled()).toBe(true);
        expect(await run.isDisabled()).toBe(true);
        await page.evaluate(() =>
          Object.assign(window.sqlImportFixture, {
            path: "/fixture/open.sql",
            sql: "PROMPT Start\nSELECT 'offen",
          }),
        );
        await replace.click();
        await page.getByRole("alert").filter({ hasText: "Offenes Literal" }).waitFor();
        expect(await run.isDisabled()).toBe(true);
      } finally {
        await browser.close();
      }
    },
    90000,
  );
}
