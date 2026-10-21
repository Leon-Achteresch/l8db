import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { openOracleApp, oracleBridge, oracleFailures } from "./fixtures/oracle-browser";

const enabled = Boolean(process.env.L8DB_ORACLE_BROWSER);
const connectionString = "oracle://l8db:l8dbtest@127.0.0.1:15219/FREEPDB1";
let browser: Browser;

async function oracle(sql: string) {
  const response = await fetch(oracleBridge, {
    method: "POST",
    body: JSON.stringify({
      command: "execute_query",
      args: { kind: "oracle", connectionString, sql },
    }),
  });
  const value = await response.json();
  if (value.error !== undefined) throw Error(value.error);
  return value.result as { rows: Record<string, unknown>[] };
}

async function cleanup() {
  await oracle(
    "BEGIN FOR o IN (SELECT object_name, object_type FROM user_objects WHERE object_name LIKE 'UIA\\_%' ESCAPE '\\' AND object_type IN ('TABLE', 'PROCEDURE')) LOOP EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' \"' || o.object_name || '\"' || CASE o.object_type WHEN 'TABLE' THEN ' PURGE' END; END LOOP; END;",
  );
}

async function withPage(name: string, body: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  try {
    const errors = await openOracleApp(page, "/query");
    await body(page);
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: `test-artifacts/oracle-ui/query-${name}-failure.png` });
    throw error;
  } finally {
    await page.close();
  }
}

async function setSql(page: Page, sql: string) {
  await page.locator(".monaco-editor .view-lines").first().click({ timeout: 20_000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

async function run(page: Page, sql: string) {
  await setSql(page, sql);
  await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
}

beforeAll(async () => {
  if (!enabled) return;
  browser = await chromium.launch();
  await cleanup();
  await oracle("CREATE TABLE uia_t (id NUMBER PRIMARY KEY, name VARCHAR2(20))");
});

afterAll(async () => {
  if (!enabled) return;
  await oracle("ALTER SESSION SET PLSQL_WARNINGS='DISABLE:ALL'").catch(() => {});
  await cleanup().catch(() => {});
  await browser?.close();
});

test.skipIf(!enabled)(
  "Oracle editor: row cap, server paging, exact count and cancel",
  async () => {
    await withPage("paging", async (page) => {
      await run(page, "SELECT * FROM ui_big ORDER BY id");
      await page.getByText("1–100 von über 100.000").waitFor();
      expect(await page.getByText(/^1000 Zeilen · \d+ ms$/).count()).toBe(1);
      await page.getByRole("button", { name: "Nächste Seite" }).click();
      await page.getByText("101–200 von über 100.000").waitFor();
      await page.getByText("genau zählen", { exact: true }).click();
      await page.getByText("101–200 von 120000").waitFor();
      await page.getByRole("button", { name: "Letzte Seite" }).click();
      await page.getByText("119901–120000 von 120000").waitFor();

      await run(page, "SELECT COUNT(*) FROM ui_big a, ui_big b, ui_big c");
      const stop = page.locator('button[title^="Abbrechen"]');
      await stop.waitFor();
      await page.waitForTimeout(1000);
      const started = Date.now();
      await stop.click();
      await page.getByText("Abfrage vom Benutzer abgebrochen.", { exact: true }).waitFor();
      const cancelMs = Date.now() - started;
      expect(cancelMs).toBeLessThan(5000);
      await run(page, "SELECT 'weiter' AS status FROM dual");
      await page.getByText("weiter", { exact: true }).first().waitFor();
      console.log(`oracle query browser: cancel ${cancelMs} ms`);
    });
  },
  90_000,
);

test.skipIf(!enabled)(
  "Oracle editor: compile warnings, error markers, server output and lint",
  async () => {
    await withPage("output", async (page) => {
      await run(page, "ALTER SESSION SET PLSQL_WARNINGS='ENABLE:ALL'");
      await page.getByText("Abgeschlossen", { exact: true }).waitFor();
      await run(
        page,
        "CREATE OR REPLACE PROCEDURE uia_warn(p IN OUT VARCHAR2) AS BEGIN p := p || 'x'; END;",
      );
      const warning = page.locator("[data-sonner-toast]", { hasText: "UIA_WARN" });
      await warning.waitFor();
      expect(await warning.locator(".l8-toast-title").innerText()).toBe(
        "PROCEDURE UIA_WARN wurde mit Warnungen kompiliert",
      );
      expect(await warning.locator(".l8-toast-description").innerText()).toContain("PLW-07203");
      await run(page, "CREATE OR REPLACE PROCEDURE uia_err AS\nBEGIN\nx := 1;\nEND;");
      await page.getByText(/^Zeile 3, Spalte \d+$/).waitFor();
      expect(await page.locator(".squiggly-error").count()).toBeGreaterThan(0);
      await run(page, "ALTER SESSION SET PLSQL_WARNINGS='DISABLE:ALL'");
      await page.getByText("Abgeschlossen", { exact: true }).waitFor();

      await run(page, "BEGIN ui_out; END;");
      await page.getByRole("button", { name: "SQL-Transaktion committen" }).click();
      await page.getByRole("button", { name: "Server-Ausgabe umschalten" }).click();
      await page.locator("li:not([data-sonner-toast])", { hasText: "PLW-07203" }).waitFor();
      await page.getByRole("switch", { name: "Aktiv" }).click();
      await page.waitForFunction(
        () => document.querySelector('[role="switch"][aria-checked="true"]') !== null,
      );
      await page.keyboard.press("Escape");
      await run(page, "BEGIN ui_out; END;");
      await page.getByRole("button", { name: "SQL-Transaktion committen" }).click();
      await page.getByRole("button", { name: "Server-Ausgabe umschalten" }).click();
      await page.getByText("Hallo aus UI_OUT", { exact: true }).waitFor();
      await page.getByText("Zweite Zeile", { exact: true }).waitFor();
      const active = page.getByRole("switch", { name: "Aktiv" });
      await active.click();
      await page.waitForFunction(
        () => document.querySelector('[role="switch"][aria-checked="false"]') !== null,
      );
      await page.keyboard.press("Escape");

      await setSql(
        page,
        "SELECT d.dummy FROM dual d JOIN sys.dual s ON 1 = 1 JOIN all_objects o ON 1 = 0",
      );
      await page.waitForTimeout(1500);
      expect(await page.locator(".squiggly-warning").count()).toBe(0);
      await setSql(page, "SELECT * FROM uia_missing");
      await page.locator(".squiggly-warning").first().waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Oracle SQL*Plus script: DEFINE, PROMPT, DESCRIBE and WHENEVER SQLERROR EXIT",
  async () => {
    await withPage("script", async (page) => {
      await setSql(
        page,
        "DEFINE wanted = 42\nPROMPT Suche &wanted\nSELECT id, txt FROM ui_big WHERE id = &wanted;\nDESCRIBE ui_big\nWHENEVER SQLERROR EXIT\nSELECT * FROM uia_missing_table;\nSELECT 'nie' FROM dual;",
      );
      await page.getByRole("button", { name: "Weitere Ausführungsarten" }).click();
      await page.getByRole("menuitem", { name: "Skript mit Einzelergebnissen" }).click();
      await page.getByText("7 Statements werden nacheinander", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Skript ausführen", exact: true }).click();
      await page.getByText("5/7 erfolgreich · 1 fehlgeschlagen", { exact: true }).waitFor();
      const rows = page.locator("button", { hasText: "SELECT id, txt FROM ui_big WHERE id = 42;" });
      expect(await rows.innerText()).toContain("1 Zeile ·");
      expect(await page.locator("button", { hasText: "DESCRIBE ui_big" }).innerText()).toContain(
        "2 Zeilen",
      );
      expect(
        await page.locator("button", { hasText: "SELECT 'nie' FROM dual;" }).innerText(),
      ).toContain("nicht ausgeführt");
      expect(
        (await oracleFailures(page)).filter((failure) => failure.command === "execute_query")
          .length,
      ).toBe(1);
    });
  },
  90_000,
);

test.skipIf(!enabled)(
  "Oracle SQL log records editor statements with masked passwords",
  async () => {
    await withPage("sql-log", async (page) => {
      const openLog = async () => {
        await page.getByRole("button", { name: "Aufgaben", exact: true }).click();
        await page.getByRole("tab", { name: /SQL-Protokoll/ }).click();
      };
      await openLog();
      const logging = page.getByRole("switch", { name: "Protokollieren" });
      if ((await logging.getAttribute("aria-checked")) !== "true") await logging.click();
      expect(await logging.getAttribute("aria-checked")).toBe("true");
      await page.keyboard.press("Escape");
      try {
        await run(page, 'CREATE USER uia_tmp IDENTIFIED BY "Geheim123"');
        await page
          .getByText(/ORA-01031/)
          .first()
          .waitFor();
        await openLog();
        await page.getByPlaceholder("SQL, Quelle oder Fehler filtern").fill("uia_tmp");
        const dialog = page.getByRole("dialog");
        await dialog
          .getByText("CREATE USER uia_tmp IDENTIFIED BY ***", { exact: true })
          .first()
          .waitFor();
        expect(await dialog.innerText()).not.toContain("Geheim123");
      } finally {
        if ((await logging.getAttribute("aria-checked")) === "true") await logging.click();
      }
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "Oracle explain: plan tree, DBMS_XPLAN text and analyze without V$ rights",
  async () => {
    await withPage("explain", async (page) => {
      await run(
        page,
        "SELECT b.txt, d.title FROM ui_big b JOIN ui_docs d ON d.id = b.id WHERE b.id < 10",
      );
      await page.getByText("Dok 9", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Analyse", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Explain", exact: true }).click();
      await sheet.getByText("7 Knoten · Gewichtung Kosten").waitFor();
      await sheet.getByRole("radio", { name: /Text/ }).click();
      await sheet.getByText(/Plan hash value: \d+/).waitFor();
      const text = await sheet.innerText();
      expect(text).toContain("UI_BIG");
      expect(text).toContain('access("D"."ID"="B"."ID")');
      expect(text).not.toContain("Zuletzt tatsächlich verwendeter Plan");
      await sheet.getByRole("button", { name: "Explain Analyze", exact: true }).click();
      await sheet.getByText(/EXPLAIN ANALYZE benötigt Leserechte auf V\$SESSION/).waitFor();
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "Oracle transactions: DML diff, rollback and commit from the panel",
  async () => {
    await withPage("transactions", async (page) => {
      await run(page, "INSERT INTO uia_t (id, name) VALUES (1, 'eins')");
      const panel = page.getByRole("region", { name: "Transaktionen" });
      await panel.getByText("SQL-Transaktion", { exact: true }).waitFor();
      await panel.getByText("UIA_T", { exact: true }).waitFor();
      await panel.getByText("eins", { exact: true }).waitFor();
      await page.getByRole("button", { name: "SQL-Transaktion zurückrollen" }).click();
      await panel.getByText("SQL-Transaktion", { exact: true }).waitFor({ state: "detached" });
      expect((await oracle("SELECT COUNT(*) AS n FROM uia_t")).rows[0].N).toBe(0);

      await run(page, "INSERT INTO uia_t (id, name) VALUES (2, 'zwei')");
      await page.getByRole("button", { name: "SQL-Transaktion committen" }).click();
      await page.getByText("Transaktion committed.").waitFor();
      expect((await oracle("SELECT name FROM uia_t")).rows).toEqual([{ NAME: "zwei" }]);
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "Oracle completion suggests tables and alias columns",
  async () => {
    await withPage("completion", async (page) => {
      await page.locator('[data-name="UI_BIG"]').first().waitFor();
      await setSql(page, "SELECT * FROM ui_b");
      await page.keyboard.press("Control+Space");
      const suggestions = page.locator(".suggest-widget .monaco-list-row");
      await suggestions.first().waitFor();
      expect((await suggestions.allInnerTexts()).some((row) => row.startsWith("UI_BIG"))).toBe(
        true,
      );
      await page.keyboard.press("Escape");
      await setSql(page, "SELECT b. FROM ui_big b");
      await page.keyboard.press("Home");
      for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Control+Space");
      await page.locator(".suggest-widget .monaco-list-row", { hasText: "TXT" }).waitFor();
      expect((await suggestions.allInnerTexts()).map((row) => row.split("\n")[0])).toEqual([
        "ID",
        "TXT",
      ]);
    });
  },
  60_000,
);
