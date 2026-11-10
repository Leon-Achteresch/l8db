import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { openOracleApp, oracleBridge } from "./fixtures/oracle-browser";

const enabled = Boolean(process.env.L8DB_ORACLE_BROWSER);
const connectionString = "oracle://l8db:l8dbtest@127.0.0.1:15219/FREEPDB1";
let browser: Browser;

async function bridge(command: string, args: Record<string, unknown>) {
  const response = await fetch(oracleBridge, {
    method: "POST",
    body: JSON.stringify({ command, args }),
  });
  const value = await response.json();
  if (value.error !== undefined) throw Error(value.error);
  return value.result;
}

async function oracle(sql: string) {
  return (await bridge("execute_query", { kind: "oracle", connectionString, sql })) as {
    rows: Record<string, unknown>[];
  };
}

const ROLLOUT = `-- SOLAGO: Planungen EXP/SOL/FIX/BKW + VE-Komm pro LB fuer SOL-SA/BKW-SA/DIR + TA_GROUP 343/344
-- Ausfuehren als SOLAGO:  sqlplus SOLAGO@slprod1 @rollout.sql
set serveroutput on
whenever sqlerror exit failure rollback

declare
  n number;
begin
  update uia_auftrag_art_planung
     set ref_buffer_relation      = 83,
         komm_lb_planen           = '1',
         opt_auto_ta_wa_abschluss = '1',
         opt_wa_lp_duty           = '1',
         opt_wa_lp_single_order   = '1'
   where ref in (3884, 3896, 3932, 3974, 4002, 4008)
     and ref_buffer_relation is null;
  n := sql%rowcount;
  dbms_output.put_line('EXP/SOL/FIX/BKW: ' || n || ' von 6');
  if n <> 6 then
    raise_application_error(-20001, 'EXP/SOL/FIX/BKW: erwartet 6 Zeilen, ' || n || ' gefunden - Stand weicht ab');
  end if;

  update uia_auftrag_art_planung
     set komm_lb_planen = '1'
   where ref in (3903, 3930, 3944, 3947, 3963, 3970)
     and komm_lb_planen = '0';
  n := sql%rowcount;
  dbms_output.put_line('SOL-SA/BKW-SA/DIR: ' || n || ' von 6');
  if n <> 6 then
    raise_application_error(-20002, 'SOL-SA/BKW-SA/DIR: erwartet 6 Zeilen, ' || n || ' gefunden - Stand weicht ab');
  end if;

  update uia_ta_group
     set ref_parent = 300,
         sort_order = case ref when 343 then 6 else sort_order end
   where ref in (343, 344)
     and ref_parent is null;
  n := sql%rowcount;
  dbms_output.put_line('TA_GROUP 343/344 unter 2MH: ' || n || ' von 2');
  if n <> 2 then
    raise_application_error(-20003, 'TA_GROUP 343/344: erwartet 2 Zeilen, ' || n || ' gefunden - Stand weicht ab');
  end if;
end;
/

commit;

select p.ref, p.auftrag_art, p.komm_art, p.ref_relation, p.ref_buffer_relation, p.ref_ta_group,
       p.komm_lb_planen, p.opt_auto_ta_wa_abschluss, p.opt_wa_lp_duty, p.opt_wa_lp_single_order
  from uia_auftrag_art_planung p
 where p.ref in (3884, 3896, 3932, 3974, 4002, 4008, 3903, 3930, 3944, 3947, 3963, 3970)
 order by p.auftrag_art, p.ref;
`;

async function cleanup() {
  await oracle(
    "BEGIN FOR o IN (SELECT object_name, object_type FROM user_objects WHERE object_name IN ('UIA_AUFTRAG_ART_PLANUNG', 'UIA_TA_GROUP', 'UIA_PLUS_T', 'UIA_PLUS_BAD')) LOOP EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' ' || o.object_name || CASE o.object_type WHEN 'TABLE' THEN ' PURGE' END; END LOOP; END;",
  );
}

async function seed() {
  await cleanup();
  await oracle(
    "CREATE TABLE uia_auftrag_art_planung (ref NUMBER PRIMARY KEY, auftrag_art VARCHAR2(10), komm_art VARCHAR2(10), ref_relation NUMBER, ref_buffer_relation NUMBER, ref_ta_group NUMBER, komm_lb_planen VARCHAR2(1), opt_auto_ta_wa_abschluss VARCHAR2(1), opt_wa_lp_duty VARCHAR2(1), opt_wa_lp_single_order VARCHAR2(1))",
  );
  await oracle(
    "CREATE TABLE uia_ta_group (ref NUMBER PRIMARY KEY, ref_parent NUMBER, sort_order NUMBER)",
  );
  await oracle(
    "BEGIN FOR r IN (SELECT column_value ref FROM TABLE(sys.odcinumberlist(3884, 3896, 3932, 3974, 4002, 4008))) LOOP INSERT INTO uia_auftrag_art_planung VALUES (r.ref, 'EXP', 'K', 1, NULL, 7, '0', '0', '0', '0'); END LOOP; FOR r IN (SELECT column_value ref FROM TABLE(sys.odcinumberlist(3903, 3930, 3944, 3947, 3963, 3970))) LOOP INSERT INTO uia_auftrag_art_planung VALUES (r.ref, 'SOL', 'K', 1, 5, 7, '0', '0', '0', '0'); END LOOP; INSERT INTO uia_ta_group VALUES (343, NULL, 1); INSERT INTO uia_ta_group VALUES (344, NULL, 2); COMMIT; END;",
  );
}

async function withPage(name: string, body: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  try {
    const errors = await openOracleApp(page, "/query");
    await body(page);
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: `test-artifacts/oracle-ui/sqlplus-${name}-failure.png` });
    throw error;
  } finally {
    await page.close();
  }
}

async function runScript(page: Page, sql: string, statements: number) {
  await page.locator(".monaco-editor .view-lines").first().click({ timeout: 20_000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.getByRole("button", { name: "Weitere Ausführungsarten" }).click();
  await page.getByRole("menuitem", { name: "Skript mit Einzelergebnissen" }).click();
  await page.getByText(`${statements} Statements werden nacheinander`, { exact: false }).waitFor();
}

beforeAll(async () => {
  if (!enabled) return;
  browser = await chromium.launch();
});

beforeEach(async () => {
  if (enabled) await seed();
});

afterAll(async () => {
  if (!enabled) return;
  await cleanup().catch(() => {});
  await browser?.close();
});

test.skipIf(!enabled)(
  "the rollout script runs completely like SQL*Plus with DBMS_OUTPUT, COMMIT and the final SELECT",
  async () => {
    await withPage("rollout", async (page) => {
      await runScript(page, ROLLOUT, 5);
      await page.getByText("Wie SQL*Plus: Autocommit ist aus.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Skript ausführen", exact: true }).click();
      await page.getByText("5/5 erfolgreich", { exact: true }).waitFor({ timeout: 60_000 });
      for (const line of [
        "EXP/SOL/FIX/BKW: 6 von 6",
        "SOL-SA/BKW-SA/DIR: 6 von 6",
        "TA_GROUP 343/344 unter 2MH: 2 von 2",
        "PL/SQL-Prozedur erfolgreich abgeschlossen.",
        "Transaktion mit COMMIT abgeschlossen.",
        "12 Zeilen ausgewählt.",
      ])
        await page.getByRole("dialog").getByText(line, { exact: true }).waitFor();
      const rows = await oracle(
        "SELECT COUNT(*) AS n FROM uia_auftrag_art_planung WHERE komm_lb_planen = '1' UNION ALL SELECT COUNT(*) FROM uia_auftrag_art_planung WHERE ref_buffer_relation = 83 UNION ALL SELECT COUNT(*) FROM uia_ta_group WHERE ref_parent = 300",
      );
      expect(rows.rows.map((row) => Number(row.N))).toEqual([12, 6, 2]);
      expect(await bridge("list_transactions", {})).toEqual([]);
    });
  },
  180_000,
);

test.skipIf(!enabled)(
  "a deviating state stops at RAISE_APPLICATION_ERROR, shows the output and rolls everything back",
  async () => {
    await oracle("UPDATE uia_auftrag_art_planung SET ref_buffer_relation = 1 WHERE ref = 4008");
    await withPage("rollout-fail", async (page) => {
      await runScript(page, ROLLOUT, 5);
      await page.getByRole("button", { name: "Skript ausführen", exact: true }).click();
      await page
        .getByText("2/5 erfolgreich · 1 fehlgeschlagen", { exact: true })
        .waitFor({ timeout: 60_000 });
      await page
        .getByRole("dialog")
        .getByText("EXP/SOL/FIX/BKW: 5 von 6", { exact: true })
        .waitFor();
      await page.getByText("EXIT FAILURE (Code 1) mit ROLLBACK", { exact: true }).waitFor();
      await page
        .getByText(/ORA-20001: EXP\/SOL\/FIX\/BKW: erwartet 6 Zeilen, 5 gefunden/)
        .first()
        .waitFor();
      expect(await page.locator("button", { hasText: /^\d+commit;/ }).innerText()).toContain(
        "nicht ausgeführt",
      );
      const rows = await oracle(
        "SELECT COUNT(*) AS n FROM uia_auftrag_art_planung WHERE ref_buffer_relation = 83 OR komm_lb_planen = '1'",
      );
      expect(Number(rows.rows[0].N)).toBe(0);
      expect(await bridge("list_transactions", {})).toEqual([]);
    });
  },
  180_000,
);

test.skipIf(!enabled)(
  "bind variables, REFCURSOR, COLUMN NEW_VALUE, compile warnings and SHOW ERRORS against Oracle",
  async () => {
    await withPage("binds", async (page) => {
      await runScript(
        page,
        [
          "set serveroutput on",
          "variable n number",
          "variable c refcursor",
          "column cnt new_value total",
          "select count(*) cnt from uia_auftrag_art_planung;",
          "exec :n := &total * 2",
          "begin open :c for select ref from uia_ta_group order by ref; dbms_output.put_line('n=' || :n); end;",
          "/",
          "print n",
          "print c",
          "create or replace procedure uia_plus_bad as begin undefined_call; end;",
          "/",
          "show errors",
          "prompt Ende &total",
        ].join("\n"),
        12,
      );
      await page.getByRole("button", { name: "Skript ausführen", exact: true }).click();
      await page.getByText(/^11\/12 erfolgreich · 1 mit Warnung$/).waitFor({ timeout: 60_000 });
      await page.getByRole("dialog").getByText("n=24", { exact: true }).waitFor();
      await page
        .getByText("Warnung: Prozedur wurde mit Kompilierungsfehlern erstellt.", { exact: true })
        .waitFor();
      await page.getByText("Ende 12", { exact: true }).waitFor();
      const row = (text: string) => page.locator("button", { hasText: text });
      expect(await row("print n").innerText()).toContain("1 Zeile");
      expect(await row("print c").innerText()).toContain("2 Zeilen ausgewählt.");
      expect(await row("show errors").innerText()).toMatch(/\d Zeilen? ·/);
      await row("print n").dispatchEvent("click");
      await page.getByText("24", { exact: true }).first().waitFor();
      await row("show errors").dispatchEvent("click");
      await page
        .getByText(/PLS-00201/)
        .first()
        .waitFor();
    });
  },
  180_000,
);

test.skipIf(!enabled)(
  "a block shows its complete DBMS_OUTPUT in the result tab without switching anything on",
  async () => {
    await withPage("dbms-output", async (page) => {
      const run = async (sql: string) => {
        await page.locator(".monaco-editor .view-lines").first().click({ timeout: 20_000 });
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(sql);
        await page.keyboard.press("ControlOrMeta+Enter");
      };
      const output = page.getByRole("tab", { name: /DBMS Output/ });
      expect(await output.count()).toBe(0);
      await run(
        "BEGIN FOR i IN 1 .. 4500 LOOP DBMS_OUTPUT.PUT_LINE('Zeile ' || i); END LOOP; END;",
      );
      await output.waitFor({ timeout: 60_000 });
      expect(await output.getAttribute("aria-selected")).toBe("true");
      expect(await output.innerText()).toContain("4.500");
      await page.getByText("Zeile 4500", { exact: true }).waitFor();
      expect(await page.getByRole("log").locator("[data-index]").count()).toBeLessThan(200);
      await page.screenshot({ path: "test-artifacts/oracle-ui/sqlplus-dbms-output.png" });
      await page.getByRole("log").evaluate((node) => node.scrollTo({ top: 0 }));
      await page.getByText("Zeile 1", { exact: true }).waitFor();
      await run("SELECT 4711 AS probe FROM dual");
      await page
        .getByRole("tab", { name: "Ergebnis", selected: true })
        .waitFor({ timeout: 60_000 });
      await page.getByText("PROBE", { exact: true }).first().waitFor();
      expect(await output.innerText()).toContain("4.500");
      for (const txId of (await bridge("list_transactions", {})) as string[])
        await bridge("rollback_transaction", { txId });
      await page.screenshot({ path: "test-artifacts/oracle-ui/sqlplus-dbms-output-result.png" });
    });
  },
  180_000,
);

test.skipIf(!enabled)(
  "script output arrives statement by statement and stays in the DBMS Output tab",
  async () => {
    await withPage("dbms-output-stream", async (page) => {
      const drawer = page.getByRole("dialog");
      const output = page.getByRole("tab", { name: /DBMS Output/ });
      const close = page.getByRole("button", { name: "Skriptergebnisse schließen" });
      const start = page.getByRole("button", { name: "Skript ausführen", exact: true });
      await runScript(
        page,
        [
          "begin dbms_output.put_line('Schritt 1'); end;",
          "/",
          "begin dbms_output.put_line('Schritt 2a'); dbms_session.sleep(4); dbms_output.put_line('Schritt 2b'); end;",
          "/",
          "begin dbms_output.put_line('Schritt 3'); end;",
          "/",
        ].join("\n"),
        3,
      );
      expect(await output.count()).toBe(0);
      await start.click();
      await drawer.getByText("Schritt 1", { exact: true }).waitFor({ timeout: 60_000 });
      const first = Date.now();
      expect(await drawer.getByText("Schritt 2a", { exact: true }).count()).toBe(0);
      await page.screenshot({ path: "test-artifacts/oracle-ui/sqlplus-dbms-output-stream.png" });
      await drawer.getByText("Schritt 2a", { exact: true }).waitFor({ timeout: 60_000 });
      expect(Date.now() - first).toBeGreaterThan(3000);
      expect(await drawer.getByText("Schritt 2b", { exact: true }).count()).toBe(1);
      await page.getByText("3/3 erfolgreich", { exact: true }).waitFor({ timeout: 60_000 });
      await close.click();
      await page.getByRole("tab", { name: /DBMS Output/, selected: true }).waitFor();
      const log = page.getByRole("log");
      for (const line of ["Schritt 1", "Schritt 2a", "Schritt 2b", "Schritt 3"])
        await log.getByText(line, { exact: true }).waitFor();
      expect(await output.innerText()).toContain("4");
      await page.screenshot({
        path: "test-artifacts/oracle-ui/sqlplus-dbms-output-stream-done.png",
      });

      await runScript(
        page,
        "begin dbms_output.put_line('Schritt 5'); end;\n/\nselect 4711 as probe from dual;",
        2,
      );
      await start.click();
      await page.getByText("2/2 erfolgreich", { exact: true }).waitFor({ timeout: 60_000 });
      await close.click();
      await page.getByRole("tab", { name: "Ergebnis", selected: true }).waitFor();
      await page.getByText("PROBE", { exact: true }).first().waitFor();
      expect(await output.innerText()).toContain("5");
      for (const txId of (await bridge("list_transactions", {})) as string[])
        await bridge("rollback_transaction", { txId });
    });
  },
  180_000,
);
