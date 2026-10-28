import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import {
  openOracleApp,
  oracleBridge,
  oracleCalls,
  oracleFailures,
} from "./fixtures/oracle-browser";

const enabled = Boolean(process.env.L8DB_ORACLE_BROWSER);
const lab = (user: string) => `oracle://${user}:l8dbtest@127.0.0.1:15219/FREEPDB1`;
const shots = "test-artifacts/oracle-ui";
let browser: Browser;

async function bridge(command: string, args: Record<string, unknown>) {
  const response = await fetch(oracleBridge, {
    method: "POST",
    body: JSON.stringify({ command, args }),
  });
  const value = await response.json();
  if (value.error !== undefined) throw new Error(`${command}: ${value.error}`);
  return value.result;
}

function sql(user: string, statement: string) {
  return bridge("execute_query", { kind: "oracle", connectionString: lab(user), sql: statement });
}

async function asAdmin(page: Page, path: string) {
  await page.addInitScript(() => {
    if (localStorage.getItem("l8db.connections")) return;
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
    );
    localStorage.setItem(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "oracle-lab",
              name: "Oracle Admin",
              kind: "oracle",
              connectionString: "oracle://uib_admin@127.0.0.1:15219/FREEPDB1",
              sslMode: "disable",
              ssh: null,
            },
          ],
          activeId: "oracle-lab",
        },
        version: 0,
      }),
    );
  });
  return openOracleApp(page, path);
}

async function newPage(name: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  try {
    await run(page);
  } catch (error) {
    await page.screenshot({ path: `${shots}/${name}-failure.png` });
    console.error(JSON.stringify(await oracleFailures(page)));
    throw error;
  } finally {
    await page.close();
  }
}

const dropUsers = `BEGIN
  FOR s IN (SELECT sid, serial# AS serial FROM v$session WHERE username IN ('UIB_ADMIN', 'UIB_VICTIM')) LOOP
    BEGIN EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ''' || s.sid || ',' || s.serial || ''' IMMEDIATE'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR u IN (SELECT username FROM dba_users WHERE username IN ('UIB_ADMIN', 'UIB_VICTIM')) LOOP
    EXECUTE IMMEDIATE 'DROP USER ' || u.username || ' CASCADE';
  END LOOP;
END;`;

async function dropLabUsers() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sql("system", dropUsers);
    } catch (error) {
      if (attempt > 40 || !String(error).includes("ORA-01940")) throw error;
      await Bun.sleep(250);
    }
  }
}

beforeAll(async () => {
  if (!enabled) return;
  await dropLabUsers();
  for (const statement of [
    "CREATE USER uib_admin IDENTIFIED BY l8dbtest QUOTA 10M ON users",
    "GRANT CREATE SESSION, CREATE TABLE, CREATE PROCEDURE, SELECT_CATALOG_ROLE, ALTER SYSTEM TO uib_admin",
    "CREATE USER uib_victim IDENTIFIED BY l8dbtest",
    "GRANT CREATE SESSION TO uib_victim",
  ])
    await sql("system", statement);
  for (const statement of [
    "CREATE TABLE uib_t (id NUMBER)",
    "CREATE OR REPLACE FUNCTION uib_f RETURN NUMBER AS n NUMBER; BEGIN SELECT COUNT(*) INTO n FROM uib_t; RETURN n; END;",
    "CREATE OR REPLACE PROCEDURE uib_p AS n NUMBER; BEGIN n := uib_f; END;",
    "DROP TABLE uib_t",
    "CREATE TABLE uib_t (id NUMBER)",
    "CREATE OR REPLACE PROCEDURE uib_dbg AS BEGIN NULL; END;",
    "ALTER PROCEDURE uib_dbg COMPILE DEBUG",
    "CREATE TABLE uib_lockt (id NUMBER PRIMARY KEY, v NUMBER)",
    "INSERT INTO uib_lockt VALUES (1, 0)",
    "GRANT SELECT, UPDATE ON uib_lockt TO uib_victim",
  ])
    await sql("uib_admin", statement);
  await sql(
    "uib_admin",
    "CREATE OR REPLACE PROCEDURE uib_broken AS\n  n NUMBER;\nBEGIN\n  SELECT COUNT(*) INTO n FROM uib_missing_table;\nEND;",
  ).catch(() => undefined);
  await sql(
    "l8db_debug",
    "CREATE OR REPLACE PROCEDURE uib_step(p_name IN VARCHAR2) AS\n  v_text VARCHAR2(40) := 'Hallo';\n  v_num NUMBER := 1;\nBEGIN\n  v_num := v_num + 1;\n  -- Kommentar\n  v_text := v_text || ' ' || p_name;\n  NULL;\nEND;",
  );
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  await browser?.close();
  await sql("l8db_debug", "DROP PROCEDURE uib_step").catch(() => undefined);
  await dropLabUsers();
}, 60_000);

test.skipIf(!enabled)(
  "invalid objects list problems, debug builds and compile single and all",
  async () => {
    await newPage("oracle-invalid", async (page) => {
      const errors = await asAdmin(page, "/invalid-objects");
      const group = (name: string) =>
        page.locator("li", { has: page.getByText(name, { exact: true }) });
      await group("UIB_BROKEN").getByText("ORA-00942: table or view does not exist").waitFor();
      await group("UIB_DBG").getByText("Debug-kompiliert", { exact: true }).waitFor();
      await group("UIB_F").waitFor();
      await group("UIB_P").waitFor();
      expect(await page.getByText("4 Objekte", { exact: true }).count()).toBe(1);

      await group("UIB_DBG").hover();
      await group("UIB_DBG").getByRole("button", { name: "Kompilieren", exact: true }).click();
      await page.getByText("UIB_ADMIN.UIB_DBG kompiliert", { exact: true }).waitFor();
      await group("UIB_DBG").waitFor({ state: "detached" });

      await page.getByRole("button", { name: "Alle kompilieren" }).click();
      await page.getByText("1 Objekt weiterhin INVALID", { exact: true }).waitFor();
      await page.getByText("2 kompiliert", { exact: true }).waitFor();
      await group("UIB_F").waitFor({ state: "detached" });
      await group("UIB_P").waitFor({ state: "detached" });
      await group("UIB_BROKEN").waitFor();
      const status = await sql(
        "uib_admin",
        "SELECT object_name, status FROM user_objects WHERE object_name IN ('UIB_F', 'UIB_P', 'UIB_DBG') ORDER BY 1",
      );
      expect(status.rows).toEqual([
        { OBJECT_NAME: "UIB_DBG", STATUS: "VALID" },
        { OBJECT_NAME: "UIB_F", STATUS: "VALID" },
        { OBJECT_NAME: "UIB_P", STATUS: "VALID" },
      ]);
      expect(errors).toEqual([]);
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "procedure editor marks compile errors and saves the fix",
  async () => {
    await newPage("oracle-procedure", async (page) => {
      const errors = await asAdmin(
        page,
        "/procedures/UIB_ADMIN/UIB_BROKEN?oid=%22UIB_ADMIN%5Cu001fUIB_BROKEN%5Cu001fPROCEDURE%22",
      );
      await page.getByText("INVALID", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Kompilieren", exact: true }).click();
      await page.getByText("UIB_ADMIN.UIB_BROKEN ist INVALID", { exact: true }).waitFor();
      await page.getByText("Kompilierfehler in Zeile 4, Position 31", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
      await page.locator(".monaco-editor .squiggly-error").first().waitFor();
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(
        'CREATE OR REPLACE PROCEDURE "UIB_ADMIN"."UIB_BROKEN" AS\n  n NUMBER;\nBEGIN\n  SELECT COUNT(*) INTO n FROM dual;\nEND;',
      );
      await page.getByRole("button", { name: "In Datenbank speichern" }).click();
      await page.getByText("INVALID", { exact: true }).waitFor({ state: "detached" });
      const status = await sql(
        "uib_admin",
        "SELECT status FROM user_objects WHERE object_name = 'UIB_BROKEN'",
      );
      expect(status.rows).toEqual([{ STATUS: "VALID" }]);
      expect(errors).toEqual([]);
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "sessions show server info, long operations, blocking locks and kill only the own session",
  async () => {
    const holder = await bridge("begin_transaction", {
      kind: "oracle",
      connectionString: lab("uib_victim"),
    });
    await bridge("execute_in_transaction", {
      txId: holder,
      sql: "UPDATE uib_admin.uib_lockt SET v = v + 1 WHERE id = 1",
    });
    const waiter = sql(
      "uib_victim",
      "BEGIN DBMS_APPLICATION_INFO.SET_MODULE('uib_waiter', NULL); UPDATE uib_admin.uib_lockt SET v = v + 1 WHERE id = 1; END;",
    ).catch(() => undefined);
    const sleeper = bridge("execute_query", {
      kind: "oracle",
      connectionString: `${lab("uib_victim")}?pool=sleeper`,
      sql: "DECLARE r BINARY_INTEGER := DBMS_APPLICATION_INFO.set_session_longops_nohint; s BINARY_INTEGER; BEGIN DBMS_APPLICATION_INFO.SET_MODULE('uib_sleeper', NULL); DBMS_APPLICATION_INFO.SET_SESSION_LONGOPS(r, s, 'UIB Export', NULL, 0, 3, 10, 'Tabelle', 'Zeilen'); DBMS_SESSION.SLEEP(28); END;",
    }).then(
      () => "finished",
      (error: Error) => error.message,
    );
    try {
      await newPage("oracle-sessions", async (page) => {
        page.on("dialog", (dialog) => void dialog.accept());
        const errors = await asAdmin(page, "/sessions");
        await page.getByPlaceholder("Benutzer").fill("UIB_VICTIM");
        const row = (module: string) => page.locator("tr", { hasText: module });
        await row("uib_sleeper")
          .getByText(/30 % UIB Export/)
          .waitFor({ timeout: 20_000 });
        await row("uib_waiter").getByText("blockiert von", { exact: true }).waitFor();
        expect(await page.locator("th", { hasText: /^SID$/ }).count()).toBe(1);

        await page.getByRole("tab", { name: /^Locks/ }).click();
        await page.getByText("UIB_ADMIN.UIB_LOCKT").first().waitFor();
        await page.getByText("wartet", { exact: true }).first().waitFor();

        await page.getByRole("tab", { name: /^Verbindung/ }).click();
        await page.getByText("SID der Metadaten-Sitzung (nicht des Editors)").waitFor();
        await page.getByText("ALTER SYSTEM, SELECT_CATALOG_ROLE", { exact: true }).waitFor();

        await page.getByRole("tab", { name: /^Sitzungen/ }).click();
        const sid = (await row("uib_sleeper").locator("td").first().innerText()).trim();
        await row("uib_sleeper").getByRole("button", { name: "Beenden" }).click();
        await page.getByText(`Sitzung ${sid} beendet.`, { exact: true }).waitFor();
        expect(await sleeper).toMatch(/ORA-000(28|31)|ORA-03113|DPI-1080/);
        await row("uib_sleeper").waitFor({ state: "detached", timeout: 15_000 });
        await row("uib_waiter").waitFor();
        const terminated = (await oracleCalls(page)).filter(
          (call) => call.command === "terminate_session",
        );
        expect(terminated.map((call) => String(call.args.pid))).toEqual([sid]);
        expect(errors).toEqual([]);
      });
    } finally {
      await bridge("rollback_transaction", { txId: holder }).catch(() => undefined);
      await waiter;
    }
  },
  90_000,
);

test.skipIf(!enabled)(
  "sessions without V$ rights explain the missing grant instead of loading forever",
  async () => {
    await newPage("oracle-sessions-rights", async (page) => {
      const errors = await openOracleApp(page, "/sessions");
      await page.getByText("Sitzungen konnten nicht geladen werden").waitFor({ timeout: 20_000 });
      await page.getByText(/Sitzungen brauchen Leserechte auf V\$SESSION/).waitFor();
      await page.waitForTimeout(6000);
      expect(await page.getByText("Lade Sitzungen…").count()).toBe(0);
      await page.getByRole("tab", { name: /^Locks/ }).click();
      await page.getByText(/Sperren brauchen Leserechte auf V\$LOCK/).waitFor();
      expect(await page.getByText("Keine Locks.").count()).toBe(0);
      expect(errors).toEqual([]);
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "connection editor keeps SID, TCPS and a wallet path with spaces in the URL",
  async () => {
    await newPage("oracle-connection", async (page) => {
      const errors = await openOracleApp(page, "/connections");
      await page.getByRole("button", { name: "Bearbeiten" }).nth(1).click();
      const sid = page.getByLabel("SID (statt Service-Name)");
      await sid.pressSequentially("FREE");
      await page.getByRole("switch", { name: "TCPS (TLS)" }).click();
      const wallet = page.getByLabel("Wallet-Verzeichnis (optional)");
      await wallet.pressSequentially("/opt/oracle/my wallet");
      expect(await wallet.inputValue()).toBe("/opt/oracle/my wallet");
      await page.getByText("URL", { exact: true }).click();
      expect(await page.locator("#connection-url").inputValue()).toBe(
        "oracle://l8db:l8dbtest@127.0.0.1:15219/FREEPDB1?sid=FREE&protocol=tcps&wallet=%2Fopt%2Foracle%2Fmy%20wallet",
      );
      await page.getByText("Felder", { exact: true }).click();
      expect(await page.getByLabel("SID (statt Service-Name)").inputValue()).toBe("FREE");
      expect(await page.getByLabel("Wallet-Verzeichnis (optional)").inputValue()).toBe(
        "/opt/oracle/my wallet",
      );
      expect(errors).toEqual([]);
    });
  },
  60_000,
);

test.skipIf(!enabled)(
  "debugger steps into a procedure, skips comment breakpoints and edits values",
  async () => {
    await newPage("oracle-debugger", async (page) => {
      const errors = await openOracleApp(
        page,
        "/procedures/L8DB_DEBUG/UIB_STEP?oid=%22L8DB_DEBUG%5Cu001fUIB_STEP%5Cu001fPROCEDURE%22",
        "oracle-debug",
      );
      try {
        await page.getByRole("button", { name: "Debuggen", exact: true }).click();
        const debug = page.locator(".debug-workbench");
        const state = (label: string) =>
          debug.locator(`.debug-status:text-is("${label}")`).waitFor({ timeout: 30_000 });
        const settle = async () => {
          await page.waitForTimeout(300);
          await state("Angehalten");
        };
        await state("Bereit");
        await debug.locator(".monaco-editor .view-lines").click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(`BEGIN\n  "L8DB_DEBUG"."UIB_STEP"('Welt');\nEND;`);
        await page.keyboard.press("F5");
        await state("Angehalten");
        await debug.getByRole("button", { name: /^Hinein/ }).click();
        await settle();
        await debug.getByText("Zeile 1", { exact: true }).waitFor();
        const gutter = async (line: number) => {
          const editor = await debug.locator(".monaco-editor").first().boundingBox();
          const number = await debug
            .locator(".monaco-editor .line-numbers", { hasText: new RegExp(`^${line}$`) })
            .first()
            .boundingBox();
          if (!editor || !number) throw new Error(`Zeile ${line} nicht sichtbar`);
          await page.mouse.click(editor.x + 10, number.y + number.height / 2);
        };
        await gutter(6);
        await page.getByText("Zeile 6 enthält keine ausführbare Anweisung.").waitFor();
        expect(await debug.getByText("0 Breakpoints").count()).toBe(1);
        await gutter(7);
        await debug.getByText("1 Breakpoints").waitFor();
        await settle();
        await page.keyboard.press("F5");
        await settle();
        await debug.getByText("Zeile 7", { exact: true }).waitFor();

        await debug.getByRole("button", { name: "Hallo", exact: true }).click();
        const text = debug.getByRole("textbox", { name: "Neuer Wert für v_text" });
        expect(await text.inputValue()).toBe("'Hallo'");
        await text.fill("'Neu'");
        await text.press("Enter");
        await settle();
        await debug.getByRole("button", { name: "Neu", exact: true }).waitFor();
        await debug.getByRole("button", { name: "2", exact: true }).click();
        const number = debug.getByRole("textbox", { name: "Neuer Wert für v_num" });
        expect(await number.inputValue()).toBe("2");
        await number.fill("41");
        await number.press("Enter");
        await settle();
        await debug.getByRole("button", { name: "41", exact: true }).waitFor();
        await page.keyboard.press("F10");
        await settle();
        await debug.getByRole("button", { name: "Neu Welt", exact: true }).waitFor();

        await debug.getByRole("button", { name: /^Stoppen/ }).click();
        await state("Abgebrochen");
        expect(errors).toEqual([]);
      } finally {
        for (const call of await oracleCalls(page)) {
          if (call.command !== "debug_launch") continue;
          await bridge("debug_stop", {
            id: (call.args.request as { id: string }).id,
            connectionString: call.args.connectionString,
            database: call.args.database,
          }).catch(() => undefined);
        }
      }
    });
  },
  90_000,
);
