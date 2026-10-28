import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import manifest from "../package.json";
import { NEXT_FEATURE_VERSION } from "../src/lib/new-features";
import { openOracleApp, oracleBridge, oracleFailures } from "./fixtures/oracle-browser";

const lab = "oracle://l8db:l8dbtest@127.0.0.1:15219/FREEPDB1";
const debug = "oracle://l8db_debug:l8dbtest@127.0.0.1:15219/FREEPDB1";

const CLEANUP = `BEGIN
  FOR o IN (SELECT object_name, object_type FROM user_objects
            WHERE object_name LIKE 'UIC\\_%' ESCAPE '\\' AND object_type IN ('TABLE', 'PROCEDURE')
            ORDER BY DECODE(object_type, 'PROCEDURE', 1, 2)) LOOP
    EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' "' || o.object_name || '"' ||
      CASE o.object_type WHEN 'TABLE' THEN ' CASCADE CONSTRAINTS PURGE' END;
  END LOOP;
END;`;

const SOURCE = [
  "CREATE TABLE uic_parent (id NUMBER PRIMARY KEY, name VARCHAR2(80) NOT NULL, code_new VARCHAR2(20))",
  "CREATE TABLE uic_child (id NUMBER PRIMARY KEY, parent_id NUMBER NOT NULL REFERENCES uic_parent(id), note VARCHAR2(40))",
  "CREATE TABLE uic_tmp_skip (id NUMBER)",
  "CREATE OR REPLACE PROCEDURE uic_proc AS n NUMBER; BEGIN SELECT COUNT(*) INTO n FROM uic_child; END;",
  "CREATE OR REPLACE PROCEDURE uic_z_helper AS BEGIN uic_proc; END;",
  "CREATE OR REPLACE PROCEDURE uic_a_caller AS BEGIN uic_z_helper; END;",
];

const TARGET = [
  "CREATE TABLE uic_parent (id NUMBER PRIMARY KEY, name VARCHAR2(30) NOT NULL, code_old VARCHAR2(20))",
  "INSERT INTO uic_parent VALUES (1, 'Erhalten', 'A1')",
  "COMMIT",
  "CREATE TABLE uic_only_tgt (id NUMBER)",
];

async function sql(connectionString: string, statement: string) {
  const response = await fetch(oracleBridge, {
    method: "POST",
    body: JSON.stringify({
      command: "execute_query",
      args: { kind: "oracle", connectionString, sql: statement },
    }),
  });
  const value = await response.json();
  if (value.error !== undefined) throw new Error(`${statement.slice(0, 60)}: ${value.error}`);
  return value.result as { rows: Record<string, unknown>[] };
}

async function showNewBadges(page: Page) {
  await page.route(/\/package\.json(\?|$)/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      `"${manifest.version}"`,
      `"${NEXT_FEATURE_VERSION}"`,
    );
    await route.fulfill({ response, body });
  });
}

async function emulateFiles(page: Page) {
  await page.addInitScript(() => {
    type Invoke = (command: string, args?: unknown, options?: unknown) => Promise<unknown>;
    const files = new Map<string, string>();
    const host = window as unknown as { savedFiles: Map<string, string>; nextOpenPath: string };
    host.savedFiles = files;
    const wrap = (value?: { invoke: Invoke }) => {
      if (!value) return value;
      const invoke = value.invoke;
      value.invoke = async (command, args, options) => {
        if (command === "plugin:dialog|save")
          return `/tmp/${(args as { options?: { defaultPath?: string } }).options?.defaultPath ?? "datei.sql"}`;
        if (command === "plugin:dialog|open") return host.nextOpenPath;
        if (command === "plugin:fs|write_text_file") {
          const headers = (options as { headers?: Record<string, string> }).headers ?? {};
          files.set(
            decodeURIComponent(headers.path ?? ""),
            new TextDecoder().decode(args as Uint8Array),
          );
          return null;
        }
        if (command === "plugin:fs|read_text_file")
          return Array.from(
            new TextEncoder().encode(files.get((args as { path: string }).path) ?? ""),
          );
        return invoke(command, args, options);
      };
      return value;
    };
    let internals = wrap(
      (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__,
    );
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => internals,
      set: (value: { invoke: Invoke }) => {
        internals = wrap(value);
      },
    });
  });
}

function savedFiles(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries((window as unknown as { savedFiles: Map<string, string> }).savedFiles),
  );
}

async function compare(page: Page) {
  await page
    .getByRole("button", { name: /Vergleichen|Neu vergleichen/ })
    .last()
    .click();
  await page.getByRole("tree", { name: "Unterschiede" }).waitFor();
}

function treeRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Unterschiede" })
    .getByRole("treeitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

test.skipIf(!process.env.L8DB_ORACLE_BROWSER)(
  "Oracle schema compare filters, renames, deploys in dependency order and compares snapshots",
  async () => {
    for (const statement of [CLEANUP, ...SOURCE]) await sql(debug, statement);
    for (const statement of [CLEANUP, ...TARGET]) await sql(lab, statement);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(20000);
    try {
      await showNewBadges(page);
      await emulateFiles(page);
      const errors = await openOracleApp(page, "/schema-compare", "oracle-debug");

      await page.getByRole("button", { name: /^Ziel:/ }).click();
      const picker = page.getByRole("dialog");
      expect(await picker.getByRole("radio", { name: /Snapshot/ }).textContent()).toContain("NEW");
      await picker.getByRole("combobox", { name: "Ziel: Verbindung" }).click();
      await page.getByRole("option", { name: "Oracle Lab" }).click();
      await picker.getByRole("combobox", { name: "Ziel: Schema" }).click();
      await page.getByRole("option", { name: "L8DB", exact: true }).click();
      await picker.getByRole("button", { name: "Als Snapshot speichern…" }).click();
      await page.getByText(/Snapshot mit \d+ Objekten gespeichert/).waitFor();
      const snapshotPath = Object.keys(await savedFiles(page)).find((path) =>
        path.endsWith(".json"),
      );
      expect(snapshotPath).toBeDefined();
      await page.keyboard.press("Escape");

      const options = page.getByRole("button", { name: /^Optionen/ });
      expect(await options.textContent()).toContain("NEW");
      await options.click();
      await page
        .getByLabel("Namen ausschließen (LIKE, mit Komma getrennt)")
        .fill("L8DB%, UI\\_%, UIC\\_TMP%");
      await page.keyboard.press("Escape");
      await compare(page);

      await treeRow(page, "UIC_CHILD").waitFor();
      expect(await treeRow(page, "UIC_TMP_SKIP").count()).toBe(0);
      expect(await treeRow(page, "UI_BIG").count()).toBe(0);
      expect(await treeRow(page, "UIC_PROC").textContent()).toMatch(/N$/);
      expect(await treeRow(page, "NAME").textContent()).toMatch(/G$/);
      expect(await treeRow(page, "UIC_ONLY_TGT").getByRole("checkbox").isChecked()).toBe(false);

      await treeRow(page, "CODE_NEW").click();
      const rename = page.getByRole("button", { name: "CODE_OLD → CODE_NEW" });
      expect(
        await page.getByText("Umbenennen statt Löschen und Anlegen:").locator("..").textContent(),
      ).toContain("NEW");
      await rename.click();
      expect(await rename.getAttribute("aria-pressed")).toBe("true");
      expect(await treeRow(page, "CODE_NEW").textContent()).toContain("umbenannt aus CODE_OLD");
      await treeRow(page, "CODE_OLD").getByRole("checkbox").click();
      expect(await treeRow(page, "CODE_NEW").getByRole("checkbox").isChecked()).toBe(false);
      await treeRow(page, "CODE_NEW").getByRole("checkbox").click();
      expect(await treeRow(page, "CODE_OLD").getByRole("checkbox").isChecked()).toBe(true);

      const foreign = page
        .getByRole("treeitem")
        .filter({ has: page.locator('button[role="checkbox"][data-state="checked"]') })
        .filter({ hasNot: page.getByRole("button", { name: /(auf|zu)klappen$/ }) })
        .filter({ hasNotText: /UIC_/ });
      while ((await foreign.count()) > 0) await foreign.first().getByRole("checkbox").click();

      await page.getByRole("button", { name: "Speichern…", exact: true }).click();
      await page.waitForFunction(() =>
        [...(window as unknown as { savedFiles: Map<string, string> }).savedFiles.keys()].some(
          (path) => path.endsWith(".sql"),
        ),
      );
      const script =
        Object.entries(await savedFiles(page)).find(([path]) => path.endsWith(".sql"))?.[1] ?? "";
      const code = script
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n");
      expect(code).toMatch(/RENAME COLUMN "CODE_OLD" TO "CODE_NEW"/);
      expect(code).not.toMatch(/DROP COLUMN "CODE_OLD"/);
      expect(code).not.toContain("UIC_ONLY_TGT");
      expect(code).not.toMatch(/L8DB_DEBUG|"UI_/);
      const child = code.search(/CREATE TABLE "L8DB"\."UIC_CHILD"/);
      const proc = code.search(/PROCEDURE "L8DB"\."UIC_PROC"/);
      const helper = code.search(/PROCEDURE "L8DB"\."UIC_Z_HELPER"/);
      const caller = code.search(/PROCEDURE "L8DB"\."UIC_A_CALLER"/);
      expect(child).toBeGreaterThanOrEqual(0);
      expect(proc).toBeGreaterThan(child);
      expect(helper).toBeGreaterThan(proc);
      expect(caller).toBeGreaterThan(helper);

      await page.getByRole("button", { name: /^In L8DB ausführen/ }).click();
      const run = page.getByRole("dialog");
      const confirm = run.getByRole("textbox", { name: "Zielschema bestätigen" });
      if ((await confirm.count()) > 0) await confirm.fill("L8DB");
      await run.getByRole("button", { name: "Ausführen", exact: true }).click();
      await run.getByText("Alle Anweisungen wurden ausgeführt.").waitFor();
      await run.getByRole("button", { name: "Schließen und neu vergleichen" }).click();
      await run.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          !document.querySelector('[role="tree"]')?.textContent?.match(/UIC_CHILD|UIC_PROC|CODE_/),
        undefined,
        { timeout: 30000 },
      );
      await treeRow(page, "UIC_ONLY_TGT").waitFor();
      const kept = await sql(
        lab,
        "SELECT code_new, (SELECT data_length FROM user_tab_columns WHERE table_name = 'UIC_PARENT' AND column_name = 'NAME') AS name_length FROM uic_parent WHERE id = 1",
      );
      expect(kept.rows[0]).toEqual({ CODE_NEW: "A1", NAME_LENGTH: 80 });
      const valid = await sql(
        lab,
        "SELECT COUNT(*) AS n FROM user_objects WHERE object_name LIKE 'UIC\\_%' ESCAPE '\\' AND object_type = 'PROCEDURE' AND status = 'VALID'",
      );
      expect(valid.rows[0]).toEqual({ N: 3 });

      await page.evaluate((path) => {
        (window as unknown as { nextOpenPath: string }).nextOpenPath = path;
      }, snapshotPath as string);
      await page.getByRole("button", { name: /^Ziel:/ }).click();
      await page
        .getByRole("dialog")
        .getByRole("radio", { name: /Snapshot/ })
        .click();
      await page.getByRole("button", { name: "Ziel: Snapshot-Datei wählen" }).click();
      await page
        .getByRole("dialog")
        .getByText(/Oracle Lab · FREEPDB1 · L8DB/)
        .waitFor();
      await page.keyboard.press("Escape");
      await compare(page);
      await treeRow(page, "UIC_CHILD").waitFor();
      expect(await treeRow(page, "CODE_NEW").count()).toBe(1);

      expect(
        (await oracleFailures(page)).filter((failure) => failure.error !== "not available"),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "test-artifacts/oracle-ui/schema-compare-failure.png" });
      throw error;
    } finally {
      await browser.close();
      await sql(debug, CLEANUP);
      await sql(lab, CLEANUP);
    }
  },
  180_000,
);
