import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Locator, type Page } from "playwright";

const enabled = Boolean(process.env.L8DB_BAAS_BROWSER);
const bridge = process.env.L8DB_BAAS_BRIDGE ?? "http://127.0.0.1:27032";
const appUrl = process.env.L8DB_BAAS_BROWSER_URL ?? "http://127.0.0.1:1432";
const supabaseUrl = process.env.L8DB_E2E_SUPABASE_URL ?? "";
const supabaseKey = process.env.L8DB_E2E_SUPABASE_KEY ?? "";
const supabasePublicKey = process.env.L8DB_E2E_SUPABASE_PUBLIC_KEY ?? "";
const convexUrl = process.env.L8DB_E2E_CONVEX_URL ?? "";
const convexKey = process.env.L8DB_E2E_CONVEX_KEY ?? "";
const artifacts = "test-artifacts/baas-ui";
const userEmail = "ui-lab@example.com";
const bucket = "l8db-ui-bucket";
const publicBucket = "l8db-ui-public";
const timings: Record<string, number> = {};
let browser: Browser;
let reference = "";

async function pgQuery(query: string) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/pg/query`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`pg/query ${response.status}: ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>[];
}

async function supabaseApi(path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function deleteUiUsers() {
  const response = await supabaseApi("/auth/v1/admin/users?per_page=1000");
  const { users } = (await response.json()) as { users: { id: string; email: string }[] };
  for (const user of users.filter((item) => item.email?.startsWith("ui-lab")))
    await supabaseApi(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
}

async function deleteUiBuckets() {
  const response = await supabaseApi("/storage/v1/bucket");
  const buckets = (await response.json()) as { id: string }[];
  for (const item of buckets.filter((entry) => entry.id.startsWith("l8db-ui"))) {
    await supabaseApi(`/storage/v1/bucket/${item.id}/empty`, { method: "POST" });
    await supabaseApi(`/storage/v1/bucket/${item.id}`, { method: "DELETE" });
  }
}

const cleanupSql = [
  "DROP TABLE IF EXISTS public.l8db_ui, public.l8db_ui_created, public.l8db_ui_renamed, public.l8db_ui_live CASCADE",
  "DROP SCHEMA IF EXISTS l8db_ui_schema CASCADE",
  "DROP TYPE IF EXISTS public.l8db_ui_mood",
  "DROP ROLE IF EXISTS l8db_ui_role",
  "DROP POLICY IF EXISTS l8db_ui_list ON storage.objects",
  "DROP EXTENSION IF EXISTS hstore",
].join("; ");

async function openApp(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await page.addInitScript((bridge) => {
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
    );
    const host = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
      baasFailures: { command: string; error: string }[];
      baasCalls: Record<string, number>;
    };
    host.baasFailures = [];
    host.baasCalls = {};
    const callbacks = new Map<number, (message: unknown) => void>();
    let nextCallback = 1;
    const call = async (command: string, args: unknown) => {
      const response = await fetch(bridge, {
        method: "POST",
        body: JSON.stringify({ command, args }),
      });
      return response.json();
    };
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    host.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (message: unknown) => void) => {
        const id = nextCallback++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (/^(mcp_|automation_|team_)/.test(command)) return Promise.reject("not available");
        if (
          command.startsWith("plugin:") ||
          command.includes("extension") ||
          command === "list_ssh_tunnels"
        )
          return [];
        if (command === "configure_execution_defaults") return null;
        host.baasCalls[command] = (host.baasCalls[command] ?? 0) + 1;
        const plain: Record<string, unknown> = {};
        const channels: string[] = [];
        for (const [key, value] of Object.entries(args)) {
          const serialize = (value as Record<string, unknown> | null)?.__TAURI_TO_IPC_KEY__;
          if (typeof serialize === "function") {
            plain[key] = serialize.call(value);
            channels.push(String(plain[key]).replace("__CHANNEL__:", ""));
          } else plain[key] = value;
        }
        let polling = channels.length > 0;
        const indexes = new Map<string, number>();
        const poll = async () => {
          while (polling) {
            for (const id of channels) {
              const { result } = await call("__channel_poll", { id });
              for (const message of result ?? []) {
                const index = indexes.get(id) ?? 0;
                indexes.set(id, index + 1);
                callbacks.get(Number(id))?.({ index, message });
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        };
        void poll();
        const value = await call(command, plain).finally(() => {
          setTimeout(() => {
            polling = false;
          }, 500);
        });
        if (value.error !== undefined) {
          if (/^(supabase|convex)_/.test(command))
            host.baasFailures.push({ command, error: value.error });
          return Promise.reject(value.error);
        }
        return value.result;
      },
    };
  }, bridge);
  await page.goto(`${appUrl}/connections`);
  return errors;
}

async function withPage(
  name: string,
  body: (page: Page) => Promise<void>,
  expectedFailures: RegExp[] = [],
) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    const errors = await openApp(page);
    await body(page);
    expect(errors).toEqual([]);
    const failures = await page.evaluate(
      () => (window as unknown as { baasFailures: { command: string }[] }).baasFailures,
    );
    expect(
      failures.filter(
        (failure) => !expectedFailures.some((pattern) => pattern.test(failure.command)),
      ),
    ).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: `${artifacts}/${name}-failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.close();
  }
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `${artifacts}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function startBaasConnection(page: Page, provider: string, mode: string) {
  await page.getByRole("button", { name: "Neue Verbindung" }).first().click();
  await page.getByRole("button", { name: provider, exact: true }).click();
  await page.getByRole("button", { name: mode }).click();
}

async function openStudio(page: Page, section: string, label: string) {
  await page.goto(`${appUrl}/baas?provider=supabase&id=${reference}&studio=${section}`);
  await page.getByRole("navigation", { name: "Supabase Studio" }).waitFor();
  return page.locator(`section[aria-label="${label}"]`);
}

async function confirmAlert(page: Page, action: string) {
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await dialog.waitFor({ state: "detached" });
}

async function runSql(page: Page, sql: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.fill(sql);
  await page.keyboard.press("Escape");
  const started = performance.now();
  await page.getByRole("button", { name: "Ausführen", exact: true }).click();
  return started;
}

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  let value = await read();
  for (let attempt = 0; attempt < 50 && !accept(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    value = await read();
  }
  return value;
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (window as unknown as { baasCalls: Record<string, number> }).baasCalls[command] ?? 0,
    command,
  );
}

async function rowWith(scope: Locator, text: string) {
  const row = scope.locator("tr").filter({ hasText: text }).first();
  await row.waitFor();
  return row;
}

beforeAll(async () => {
  if (!enabled) return;
  browser = await chromium.launch();
  await deleteUiUsers();
  await deleteUiBuckets();
  await pgQuery(cleanupSql);
  await pgQuery(
    "CREATE TABLE public.l8db_ui (id int PRIMARY KEY, label text); INSERT INTO public.l8db_ui VALUES (1, 'erste Zeile'), (2, 'zweite Zeile'); GRANT SELECT ON public.l8db_ui TO anon",
  );
});

afterAll(async () => {
  if (!enabled) return;
  await pgQuery(cleanupSql).catch(() => {});
  if (convexUrl) await convexCleanup().catch(() => {});
  await deleteUiUsers().catch(() => {});
  await deleteUiBuckets().catch(() => {});
  await browser?.close();
  if (Object.keys(timings).length) console.log("BaaS UI timings (ms)", timings);
});

test.skipIf(!enabled)(
  "Supabase Studio: verbinden und Übersicht",
  async () => {
    await withPage(
      "supabase-connect",
      async (page) => {
        await startBaasConnection(page, "Supabase", "Projekt-URL & Key");
        await page.getByLabel("Projekt-URL (NEXT_PUBLIC_SUPABASE_URL)").fill("http://127.0.0.1:9");
        await page
          .getByLabel("Publishable/anon Key oder Secret/service_role Key")
          .fill(supabaseKey);
        await page.getByRole("button", { name: "Verbindung speichern" }).click();
        await page.getByRole("alert").filter({ hasText: "nicht erreichbar" }).waitFor();
        await page.getByLabel("Projekt-URL (NEXT_PUBLIC_SUPABASE_URL)").fill(supabaseUrl);
        await page.getByLabel("Name (optional)").fill("Supabase Lab");
        await page.getByRole("button", { name: "Verbindung speichern" }).click();

        const card = page.locator("article").filter({ hasText: "Supabase Lab" });
        await card.waitFor();
        await card.getByRole("button", { name: "Projekt öffnen" }).last().click();
        const nav = page.getByRole("navigation", { name: "Supabase Studio" });
        await nav.waitFor();
        reference = new URL(page.url()).searchParams.get("id") ?? "";
        expect(reference).toStartWith("self-");
        for (const label of [
          "Übersicht",
          "Tabellen",
          "SQL",
          "Datenbank",
          "Richtlinien",
          "Auth",
          "Storage",
          "Edge Functions",
          "Realtime",
          "Logs & Leistung",
          "Einstellungen",
        ])
          expect(await nav.getByRole("button", { name: label }).isEnabled()).toBe(true);

        const main = page.locator("section[aria-label='Übersicht']");
        await main.getByText("ACTIVE_HEALTHY").nth(4).waitFor();
        expect(await main.getByText("ACTIVE_HEALTHY").count()).toBe(5);
        await main.getByText("Secret Key", { exact: true }).waitFor();
        await main.getByText("Datenbankgröße").waitFor();
        await shot(page, "01-overview");
        await main.getByRole("button", { name: "Tabellen" }).first().click();
        await page.waitForURL(/studio=tables/);
      },
      [/^supabase_connect_self_hosted$/],
    );
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Tabellen erstellen, bearbeiten, ändern, löschen",
  async () => {
    await withPage("supabase-tables", async (page) => {
      const main = await openStudio(page, "tables", "Tabellen");
      const table = main.getByRole("button", { name: /^l8db_ui\b/ });
      await table.waitFor();
      const started = performance.now();
      await table.click();
      await main.getByText("zweite Zeile").waitFor();
      timings.tablesFirstData = Math.round(performance.now() - started);
      expect(timings.tablesFirstData).toBeLessThan(2000);
      expect(await calls(page, "supabase_studio_tables_describe")).toBe(1);
      expect(await calls(page, "supabase_studio_tables_rows")).toBe(1);

      await main.getByRole("button", { name: "Tabelle erstellen" }).click();
      const create = page.getByRole("dialog");
      await create.getByLabel("Name", { exact: true }).fill("l8db_ui_created");
      expect(await create.getByLabel("Spaltenname").first().inputValue()).toBe("id");
      await create.getByRole("button", { name: "Spalte", exact: true }).click();
      await create.getByLabel("Spaltenname").nth(2).fill("title");
      await shot(page, "02-table-create");
      await create.getByRole("button", { name: "Erstellen" }).click();
      await create.waitFor({ state: "detached" });
      await main.getByRole("heading", { name: "public.l8db_ui_created" }).waitFor();

      await main.getByRole("button", { name: "Zeile", exact: true }).click();
      const insert = page.getByRole("dialog");
      await insert.getByLabel("title", { exact: true }).fill("Neue Zeile");
      await insert.getByRole("button", { name: "Einfügen" }).click();
      await insert.waitFor({ state: "detached" });
      const inserted = await rowWith(main, "Neue Zeile");

      await inserted.getByRole("button", { name: "Zeile bearbeiten" }).click();
      const edit = page.getByRole("dialog");
      await edit.getByLabel("title", { exact: true }).fill("Geänderte Zeile");
      await edit.getByRole("button", { name: "Speichern", exact: true }).click();
      await edit.waitFor({ state: "detached" });
      const edited = await rowWith(main, "Geänderte Zeile");
      await shot(page, "03-table-grid");

      await edited.getByRole("checkbox", { name: "Zeile auswählen" }).click();
      await main.getByRole("button", { name: "1 löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("1 Zeilen gelöscht.").waitFor();
      await main.getByText("Keine Zeilen auf dieser Seite.").waitFor();

      await main.getByRole("tab", { name: "Struktur" }).click();
      await main.getByRole("button", { name: "Spalte title ändern" }).click();
      const alter = page.getByRole("dialog");
      await alter.getByLabel("Name").fill("headline");
      await alter.getByLabel("Datentyp").fill("varchar(80)");
      await alter.getByRole("button", { name: "Speichern" }).click();
      await alter.waitFor({ state: "detached" });
      await main.getByRole("button", { name: "Spalte headline ändern" }).waitFor();
      await shot(page, "04-table-structure");
      const columns = await pgQuery(
        "select data_type from information_schema.columns where table_name = 'l8db_ui_created' and column_name = 'headline'",
      );
      expect(columns[0]?.data_type).toBe("character varying");

      await main.getByText("RLS aktiv").waitFor();
      await main.getByRole("button", { name: "Tabellenaktionen" }).click();
      await page.getByRole("menuitem", { name: "RLS deaktivieren" }).click();
      await main.getByText("RLS aus", { exact: true }).waitFor();

      await main.getByRole("button", { name: "Tabellenaktionen" }).click();
      await page.getByRole("menuitem", { name: "Umbenennen…" }).click();
      const rename = page.getByRole("dialog");
      await rename.getByLabel("Neuer Name").fill("l8db_ui_renamed");
      await rename.getByRole("button", { name: "Umbenennen" }).click();
      await rename.waitFor({ state: "detached" });
      await main.getByRole("heading", { name: "public.l8db_ui_renamed" }).waitFor();

      await main.getByRole("button", { name: "Tabellenaktionen" }).click();
      await page.getByRole("menuitem", { name: "Tabelle löschen…" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByRole("heading", { name: "public.l8db_ui_renamed" }).waitFor({
        state: "detached",
      });
      expect(
        await pgQuery(
          "select 1 from pg_tables where tablename in ('l8db_ui_created', 'l8db_ui_renamed')",
        ),
      ).toEqual([]);
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: SQL ausführen und destruktive Anweisung bestätigen",
  async () => {
    await withPage("supabase-sql", async (page) => {
      const main = await openStudio(page, "sql", "SQL");
      const started = await runSql(page, "select id, label from public.l8db_ui order by id");
      await main.getByText("zweite Zeile").waitFor();
      timings.sqlFirstData = Math.round(performance.now() - started);
      expect(timings.sqlFirstData).toBeLessThan(2000);
      expect(await calls(page, "supabase_studio_sql_run")).toBe(1);
      await main.getByText("2 Zeilen").first().waitFor();
      await shot(page, "05-sql-result");

      await runSql(page, "drop table if exists public.l8db_ui_scratch");
      const confirm = page.getByRole("dialog").filter({ hasText: "Destruktive SQL-Anweisung" });
      await confirm.waitFor();
      await shot(page, "06-sql-confirm");
      await confirm.getByRole("button", { name: "Abbrechen" }).click();
      await confirm.waitFor({ state: "detached" });
      await runSql(page, "drop table if exists public.l8db_ui_scratch");
      await confirm.getByRole("button", { name: "Abfrage ausführen" }).click();
      await main.getByText("Anweisung ausgeführt.", { exact: false }).waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Datenbankobjekte anlegen und löschen",
  async () => {
    await withPage("supabase-database", async (page) => {
      const main = await openStudio(page, "database", "Datenbank");
      const search = main.getByLabel("Suchen", { exact: true });

      await main.getByLabel("Name des neuen Schemas").fill("l8db_ui_schema");
      await main.getByRole("button", { name: "Erstellen" }).click();
      await search.fill("l8db_ui_schema");
      await rowWith(main, "l8db_ui_schema");
      await shot(page, "07-database-schemas");
      await main.getByRole("button", { name: "Schema l8db_ui_schema löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("l8db_ui_schema", { exact: true }).waitFor({ state: "detached" });

      await main.getByRole("tab", { name: "Indizes" }).click();
      await main.getByRole("button", { name: "Index", exact: true }).click();
      const index = page.getByRole("dialog");
      await index.getByLabel("Tabelle", { exact: true }).fill("l8db_ui");
      await index.getByLabel("Spalten").fill("label");
      await index.getByLabel("Indexname").fill("l8db_ui_label_idx");
      await index.getByRole("button", { name: "Erstellen" }).click();
      await index.waitFor({ state: "detached" });
      await main.getByLabel("Nach Tabelle filtern").fill("l8db_ui");
      await rowWith(main, "l8db_ui_label_idx");
      await shot(page, "08-database-indexes");
      await main.getByRole("button", { name: "Index l8db_ui_label_idx löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("l8db_ui_label_idx").waitFor({ state: "detached" });

      await main.getByRole("tab", { name: "Enums" }).click();
      await main.getByLabel("Name des neuen Enums").fill("l8db_ui_mood");
      await main.getByLabel("Werte des neuen Enums").fill("gut, schlecht");
      await main.getByRole("button", { name: "Erstellen" }).click();
      const mood = await rowWith(main, "l8db_ui_mood");
      await mood.getByLabel("Neuer Wert für l8db_ui_mood").fill("mittel");
      await mood.getByRole("button", { name: "Hinzufügen" }).click();
      await mood.getByText("mittel", { exact: true }).waitFor();
      await shot(page, "09-database-enums");
      await main.getByRole("button", { name: "Enum l8db_ui_mood löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("l8db_ui_mood").waitFor({ state: "detached" });

      await main.getByRole("tab", { name: "Erweiterungen" }).click();
      await search.fill("hstore");
      const hstore = await rowWith(main, "hstore");
      await hstore.getByRole("button", { name: "Aktivieren" }).click();
      await hstore.getByRole("button", { name: "Deaktivieren" }).click();
      await confirmAlert(page, "Deaktivieren");
      await hstore.getByRole("button", { name: "Aktivieren" }).waitFor();

      await main.getByRole("tab", { name: "Rollen" }).click();
      await main.getByRole("button", { name: "Rolle", exact: true }).click();
      const role = page.getByRole("dialog");
      await role.getByLabel("Rollenname").fill("l8db_ui_role");
      await role.getByRole("button", { name: "Speichern" }).click();
      await role.waitFor({ state: "detached" });
      await search.fill("l8db_ui_role");
      await rowWith(main, "l8db_ui_role");
      await shot(page, "10-database-roles");
      await main.getByRole("button", { name: "Rolle l8db_ui_role löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("l8db_ui_role").waitFor({ state: "detached" });

      for (const tab of ["Views", "Funktionen", "Trigger", "Publikationen", "Sequenzen"]) {
        await main.getByRole("tab", { name: tab }).click();
        await main.locator("table, p").first().waitFor();
      }
      expect(
        await pgQuery(
          "select (select count(*) from pg_namespace where nspname = 'l8db_ui_schema') + (select count(*) from pg_roles where rolname = 'l8db_ui_role') + (select count(*) from pg_type where typname = 'l8db_ui_mood') + (select count(*) from pg_extension where extname = 'hstore') + (select count(*) from pg_indexes where indexname = 'l8db_ui_label_idx') as leftovers",
        ),
      ).toEqual([{ leftovers: 0 }]);
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Richtlinien und RLS",
  async () => {
    await withPage("supabase-policies", async (page) => {
      const main = await openStudio(page, "policies", "Richtlinien");
      const table = await rowWith(main, "l8db_ui");
      await table.getByText("Ungeschützt").waitFor();
      await main.getByRole("switch", { name: "RLS für l8db_ui", exact: true }).click();
      await table.getByText("Ungeschützt").waitFor({ state: "detached" });
      await table.getByRole("button", { name: "0" }).click();
      await main.getByRole("button", { name: "Richtlinie", exact: true }).click();
      const form = page.getByRole("dialog");
      await form.getByRole("button", { name: "Jeder darf lesen" }).click();
      await form.getByLabel("Name der Richtlinie").fill("l8db_ui_read");
      await shot(page, "11-policy-form");
      await form.getByRole("button", { name: "Speichern" }).click();
      await form.waitFor({ state: "detached" });
      await rowWith(main, "l8db_ui_read");
      await shot(page, "12-policies");
      await main.getByRole("button", { name: "Richtlinie l8db_ui_read löschen" }).click();
      await confirmAlert(page, "Löschen");
      await main.getByText("l8db_ui_read").waitFor({ state: "detached" });
      await main.getByRole("switch", { name: "RLS für l8db_ui", exact: true }).click();
      await confirmAlert(page, "Deaktivieren");
      await table.getByText("Ungeschützt").waitFor();
      await main.getByRole("tab", { name: "Storage" }).click();
      await main.locator("table, p").first().waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Auth-Benutzer verwalten",
  async () => {
    await withPage("supabase-auth", async (page) => {
      const main = await openStudio(page, "auth", "Auth");
      await main.getByRole("button", { name: "Benutzer erstellen" }).click();
      const create = page.getByRole("dialog");
      await create.getByLabel("E-Mail-Adresse").fill(userEmail);
      await create.getByLabel("Passwort (optional)").fill("secret-pw");
      await create.getByRole("button", { name: "Erstellen" }).click();
      await page.getByRole("heading", { name: userEmail }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await main.getByLabel("Benutzer suchen").fill("ui-lab");
      await main.getByRole("button", { name: "Suchen", exact: true }).click();
      await main.getByRole("button", { name: userEmail }).click();
      await shot(page, "13-auth-user");

      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("E-Mail-Adresse").fill("ui-lab-2@example.com");
      await sheet.getByRole("button", { name: "Speichern" }).first().click();
      await sheet.getByRole("heading", { name: "ui-lab-2@example.com" }).waitFor();

      await sheet.getByRole("button", { name: "Sperren", exact: true }).click();
      await sheet.getByText("Gesperrt", { exact: true }).waitFor();
      await sheet.getByRole("button", { name: "Entsperren" }).click();
      await sheet.getByText("Benutzer sperren").waitFor();

      await sheet.getByRole("button", { name: "Link erzeugen" }).click();
      const link = page.getByRole("dialog").filter({ hasText: "Erzeugt einen Auth-Link" });
      await link.getByRole("button", { name: "Link erzeugen" }).click();
      await link.getByText("E-Mail-OTP").waitFor();
      await shot(page, "14-auth-link");
      await link.getByRole("button", { name: "Schließen" }).click();
      await link.waitFor({ state: "detached" });

      await sheet.getByRole("button", { name: "Löschen", exact: true }).click();
      await confirmAlert(page, "Bestätigen");
      await main
        .getByRole("button", { name: "ui-lab-2@example.com" })
        .waitFor({ state: "detached" });
      const response = await supabaseApi("/auth/v1/admin/users?per_page=1000");
      const { users } = (await response.json()) as { users: { email: string }[] };
      expect(users.filter((user) => user.email?.startsWith("ui-lab"))).toEqual([]);

      await main.getByRole("tab", { name: "Konfiguration" }).click();
      await main.getByText("Aktive Einstellungen").waitFor();
      await shot(page, "15-auth-config");
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Storage-Bucket und Dateien verwalten",
  async () => {
    await withPage("supabase-storage", async (page) => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      const main = await openStudio(page, "storage", "Storage");
      await main.getByRole("button", { name: "Neuer Bucket" }).click();
      const create = page.getByRole("dialog");
      await create.getByLabel("Name", { exact: true }).fill(bucket);
      await create.getByRole("button", { name: "Erstellen" }).click();
      await create.waitFor({ state: "detached" });
      await main.getByRole("button", { name: bucket }).click();

      await main.getByRole("button", { name: "Bearbeiten" }).click();
      const settings = page.getByRole("dialog");
      await settings.getByLabel("Öffentlicher Bucket").click();
      await settings.getByLabel("Erlaubte MIME-Typen").fill("text/plain");
      await settings.getByRole("button", { name: "Speichern" }).click();
      await settings.waitFor({ state: "detached" });
      const saved = await poll(
        async () =>
          (await (await supabaseApi(`/storage/v1/bucket/${bucket}`)).json()) as {
            public: boolean;
            allowed_mime_types: string[] | null;
          },
        (value) => value.public,
      );
      expect([saved.public, saved.allowed_mime_types]).toEqual([true, ["text/plain"]]);

      await main.getByRole("button", { name: "Hochladen" }).click();
      await rowWith(main, "l8db-upload.txt");
      await main.getByRole("button", { name: "Ordner", exact: true }).click();
      await main.getByLabel("Neuer Ordnername").fill("docs");
      await main.getByRole("button", { name: "Erstellen", exact: true }).click();
      await main.getByText("Dieser Ordner ist leer.").waitFor();
      await main.getByRole("button", { name: bucket, exact: true }).last().click();
      await rowWith(main, "docs");
      await shot(page, "16-storage-objects");

      await main.getByRole("button", { name: "l8db-upload.txt" }).click();
      const details = main.getByRole("complementary", { name: "Datei-Details" });
      await details.getByText("Öffentliche URL").waitFor();
      await details.getByRole("button", { name: "Erstellen & kopieren" }).click();
      const signed = details.locator("input[readonly]").last();
      expect(
        await poll(
          () => signed.inputValue(),
          (value) => value.includes("/object/sign/"),
        ),
      ).toContain("/object/sign/");
      const download = await fetch(
        new URL(
          (await signed.inputValue()).replace(/^https?:\/\/[^/]+/, ""),
          supabaseUrl,
        ).toString(),
      );
      expect(await download.text()).toBe("l8db browser upload");
      await shot(page, "17-storage-details");

      await details.getByRole("button", { name: "Verschieben" }).click();
      const move = page.getByRole("dialog");
      await move.getByLabel("Zielpfad").fill("renamed.txt");
      await move.getByRole("button", { name: "Verschieben" }).click();
      await move.waitFor({ state: "detached" });
      const renamed = await rowWith(main, "renamed.txt");
      await renamed.getByRole("checkbox").click();
      await main.getByRole("button", { name: "Kopieren", exact: true }).click();
      const copy = page.getByRole("dialog");
      await copy.getByLabel("Zielpfad").fill("docs/copy.txt");
      await copy.getByRole("button", { name: "Kopieren" }).click();
      await copy.waitFor({ state: "detached" });
      await main.getByRole("button", { name: "docs", exact: true }).click();
      await rowWith(main, "copy.txt");
      await main.getByRole("button", { name: bucket, exact: true }).last().click();

      await (await rowWith(main, "renamed.txt")).getByRole("checkbox").click();
      await (await rowWith(main, "docs")).getByRole("checkbox").click();
      await main
        .getByText("2 ausgewählt")
        .locator("..")
        .getByRole("button", { name: "Löschen" })
        .click();
      await page.getByRole("alertdialog").getByText("2 Einträge endgültig löschen?").waitFor();
      await confirmAlert(page, "Löschen");
      await main.getByText("renamed.txt").waitFor({ state: "detached" });

      await main.getByRole("button", { name: "Löschen", exact: true }).click();
      await confirmAlert(page, "Bucket löschen");
      await main.getByRole("button", { name: bucket }).waitFor({ state: "detached" });
      const response = await supabaseApi(`/storage/v1/bucket/${bucket}`);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Edge Function aufrufen",
  async () => {
    await withPage("supabase-functions", async (page) => {
      const main = await openStudio(page, "functions", "Edge Functions");
      await main.getByLabel("Function-Slug hinzufügen").fill("hello");
      await main.getByRole("button", { name: "Slug hinzufügen" }).click();
      await main.getByRole("button", { name: "hello", exact: true }).click();
      await main.getByRole("combobox", { name: "Authentifizierung" }).click();
      await page.getByRole("option", { name: "Ohne Authentifizierung" }).click();
      await main.getByPlaceholder("x-region: eu").fill(`apikey: ${supabasePublicKey}`);
      const started = performance.now();
      await main.getByRole("button", { name: "Senden" }).click();
      await main.getByText("Hello from Edge Functions!").waitFor();
      timings.edgeInvoke = Math.round(performance.now() - started);
      await main.getByText("HTTP 200").waitFor();
      await shot(page, "18-functions-invoke");
      await main.getByRole("button", { name: "hello entfernen" }).click();
      await main.getByRole("button", { name: "hello", exact: true }).waitFor({ state: "detached" });
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Realtime Postgres-Änderungen und Broadcast",
  async () => {
    await withPage("supabase-realtime", async (page) => {
      const main = await openStudio(page, "realtime", "Realtime");
      await main.getByRole("tab", { name: "Publikation" }).click();
      await main.getByLabel("Tabellen suchen").fill("l8db_ui");
      const publish = main.getByRole("switch", { name: "Realtime für public.l8db_ui" });
      await publish.click();
      await poll(
        () => publish.getAttribute("aria-checked"),
        (value) => value === "true",
      );
      expect(await publish.getAttribute("aria-checked")).toBe("true");

      await main.getByRole("tab", { name: "Inspektor" }).click();
      await main.getByLabel("Tabelle", { exact: true }).fill("l8db_ui");
      await main.getByRole("button", { name: "Verbinden" }).click();
      await main.getByText("Verbunden", { exact: true }).waitFor();
      await main.getByText("Subscribed to PostgreSQL").first().waitFor();
      const insert = main.getByText("INSERT public.l8db_ui").first();
      let started = performance.now();
      for (let id = 3; id < 15 && !(await insert.isVisible()); id++) {
        timings.realtimeInsertAttempts = id - 2;
        started = performance.now();
        await pgQuery(`INSERT INTO public.l8db_ui VALUES (${id}, 'live Zeile')`);
        await insert.waitFor({ timeout: 5000 }).catch(() => {});
      }
      await insert.waitFor({ timeout: 1000 });
      timings.realtimeInsert = Math.round(performance.now() - started);
      await insert.click();
      await main.getByText("live Zeile", { exact: false }).waitFor();

      await main.getByRole("button", { name: "Senden" }).click();
      await main.getByText("Gesendet.").waitFor();
      await main.getByRole("radio", { name: "Broadcast" }).click();
      await main
        .getByRole("button", { name: /broadcast\s*message/ })
        .first()
        .waitFor();
      await shot(page, "19-realtime");
      await main.getByRole("button", { name: "Trennen" }).click();
      await main.getByText("Verbunden", { exact: true }).waitFor({ state: "detached" });
      await pgQuery("DELETE FROM public.l8db_ui WHERE id >= 3");

      await main.getByRole("tab", { name: "Publikation" }).click();
      await main.getByLabel("Tabellen suchen").fill("l8db_ui");
      await publish.click();
      await poll(
        () => publish.getAttribute("aria-checked"),
        (value) => value === "false",
      );
      expect(await publish.getAttribute("aria-checked")).toBe("false");
    });
  },
  180_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Logs und Leistung",
  async () => {
    await withPage("supabase-logs", async (page) => {
      const main = await openStudio(page, "logs", "Logs & Leistung");
      await main.getByRole("columnheader", { name: "PID" }).waitFor();
      await main.getByText("Inaktive Sitzungen anzeigen").click();
      await rowWith(main, "idle");
      await shot(page, "20-logs-sessions");
      await main.getByRole("tab", { name: "Sperren" }).click();
      await main.locator("table, p").first().waitFor();
      await main.getByRole("tab", { name: "Abfragen" }).click();
      await main.getByText("Top-Abfragen").waitFor();
      await main.getByRole("columnheader", { name: "Aufrufe" }).waitFor();
      await shot(page, "21-logs-statements");
      await main.getByRole("tab", { name: "Datenbank-Zustand" }).click();
      await main.locator("table").first().waitFor();
      await shot(page, "22-logs-health");
      await main.getByRole("tab", { name: "Logs" }).click();
      await main.locator("table, p").first().waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "Supabase Studio: Einstellungen und trennen",
  async () => {
    await withPage("supabase-settings", async (page) => {
      const main = await openStudio(page, "settings", "Einstellungen");
      await main.getByText("Secret/service_role Key").waitFor();
      await main.getByRole("button", { name: "Anzeigen" }).click();
      await main.getByText(`${supabaseKey.slice(0, 8)}••••`, { exact: false }).waitFor();
      expect(await main.getByText(supabaseKey.slice(0, 24), { exact: false }).count()).toBe(0);
      await main.getByText("Pooler (Supavisor)").waitFor();
      await shot(page, "23-settings");
      await main.getByRole("button", { name: "Trennen" }).click();
      const confirm = page.getByRole("dialog");
      await confirm.getByLabel("Name zur Bestätigung").fill("Supabase Lab");
      await confirm.getByRole("button", { name: "Trennen" }).click();
      await page.getByRole("heading", { name: "Supabase verbinden" }).waitFor();
    });
  },
  120_000,
);

test.skipIf(!enabled || !supabasePublicKey)(
  "Supabase Studio mit Publishable Key: gesperrte Bereiche, Tabelle per Namen, RLS, Storage",
  async () => {
    await pgQuery(
      "ALTER TABLE public.l8db_ui ENABLE ROW LEVEL SECURITY; CREATE POLICY l8db_ui_first ON public.l8db_ui FOR SELECT TO anon USING (id = 1); CREATE POLICY l8db_ui_list ON storage.objects FOR SELECT TO anon USING (bucket_id = 'l8db-ui-public')",
    );
    await supabaseApi("/storage/v1/bucket", {
      method: "POST",
      body: JSON.stringify({ id: publicBucket, name: publicBucket, public: true }),
    });
    await supabaseApi(`/storage/v1/object/${publicBucket}/hallo.txt`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "Hallo",
    });
    await withPage("supabase-public", async (page) => {
      await startBaasConnection(page, "Supabase", "Projekt-URL & Key");
      await page
        .getByLabel("Projekt-URL (NEXT_PUBLIC_SUPABASE_URL)")
        .fill(`NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`);
      await page
        .getByLabel("Publishable/anon Key oder Secret/service_role Key")
        .fill(supabasePublicKey);
      await page.getByLabel("Name (optional)").fill("Supabase App");
      await page.getByRole("button", { name: "Verbindung speichern" }).click();

      const card = page.locator("article").filter({ hasText: "Supabase App" });
      await card.waitFor();
      await card.getByRole("button", { name: "Projekt öffnen" }).last().click();
      const nav = page.getByRole("navigation", { name: "Supabase Studio" });
      await nav.waitFor();
      const overview = page.locator("section[aria-label='Übersicht']");
      await overview.getByText("Publishable Key", { exact: true }).waitFor();
      await nav.getByRole("button", { name: "Tabellen" }).waitFor({ state: "visible" });
      for (const label of ["SQL", "Datenbank", "Richtlinien", "Auth", "Logs & Leistung"]) {
        const item = nav.getByRole("button", { name: label });
        expect(await item.isDisabled()).toBe(true);
        expect(await item.getAttribute("title")).toMatch(/^Benötigt /);
      }
      for (const label of [
        "Übersicht",
        "Tabellen",
        "Storage",
        "Edge Functions",
        "Realtime",
        "Einstellungen",
      ])
        expect(await nav.getByRole("button", { name: label }).isEnabled()).toBe(true);
      await shot(page, "24-public-overview");

      await nav.getByRole("button", { name: "Tabellen" }).click();
      const tables = page.locator("section[aria-label='Tabellen']");
      await tables.getByLabel("Tabellenname").fill("l8db_ui");
      await tables.getByRole("button", { name: "Öffnen", exact: true }).click();
      await tables.getByText("erste Zeile").waitFor();
      expect(await tables.getByText("zweite Zeile").count()).toBe(0);
      await tables.getByText("Row Level Security gilt", { exact: false }).waitFor();
      await shot(page, "25-public-table");

      await nav.getByRole("button", { name: "Storage" }).click();
      const storage = page.locator("section[aria-label='Storage']");
      await storage.getByLabel("Bucket-Name zum Öffnen").fill(publicBucket);
      await storage.getByRole("button", { name: "Öffnen", exact: true }).click();
      await rowWith(storage, "hallo.txt");
      await shot(page, "26-public-storage");

      await page.getByRole("button", { name: "Trennen" }).first().click();
      await page.getByRole("heading", { name: "Supabase verbinden" }).waitFor();
    });
  },
  120_000,
);

const convexTable = "l8db_ui_scratch";
let convexId = "";

async function convexApi(path: string, body?: unknown) {
  const response = await fetch(`${convexUrl.replace(/\/$/, "")}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Convex ${convexKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw Error(`${path} ${response.status}: ${await response.text()}`);
  return response.headers.get("content-type")?.includes("json") ? response.json() : null;
}

async function convexCleanup() {
  await convexApi("api/v1/unpause_deployment", {}).catch(() => {});
  await convexApi("api/cancel_all_jobs", {
    componentId: null,
    udfPath: "messages.js:insertInternal",
  }).catch(() => {});
  await convexApi("api/delete_tables", { tableNames: [convexTable], componentId: null }).catch(
    () => {},
  );
  const { environmentVariables } = (await convexApi("api/v1/list_environment_variables")) as {
    environmentVariables: Record<string, string>;
  };
  const changes = Object.keys(environmentVariables)
    .filter((name) => name.startsWith("L8DB_UI"))
    .map((name) => ({ name, value: null }));
  if (changes.length) await convexApi("api/v1/update_environment_variables", { changes });
}

async function runLogAction(note: string) {
  const response = await fetch(`${convexUrl.replace(/\/$/, "")}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "actions:logSomething", args: { note }, format: "json" }),
  });
  expect(response.ok).toBe(true);
}

async function openConvex(page: Page, section: string, label: string) {
  await page.goto(`${appUrl}/baas?provider=convex&id=${convexId}&studio=${section}`);
  await page.getByRole("navigation", { name: "Convex Studio" }).waitFor();
  return page.locator(`section[aria-label="${label}"]`);
}

async function selectFunction(main: Locator, module: string, name: string) {
  await main.getByLabel("Funktionen durchsuchen").fill(name);
  await main
    .locator("details")
    .filter({ hasText: `${module}.js` })
    .getByRole("button", { name: new RegExp(`^\\w\\s*${name}(\\s|$)`) })
    .click();
}

async function fillJson(page: Page, scope: Locator, text: string) {
  await scope.getByRole("tab", { name: "Code" }).first().click();
  await scope.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

async function runFunction(page: Page, main: Locator, args: string) {
  await fillJson(page, main, args);
  const started = performance.now();
  await main.getByRole("button", { name: "Ausführen", exact: true }).click();
  return started;
}

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: verbinden und Übersicht",
  async () => {
    await convexCleanup();
    await withPage("convex-connect", async (page) => {
      await startBaasConnection(page, "Convex", "Selbst gehostet");
      await page.getByLabel("Backend-URL, z. B. http://127.0.0.1:3210").fill(convexUrl);
      await page.getByLabel("Admin-Key").fill(convexKey);
      await page.getByRole("button", { name: "Verbindung speichern" }).click();
      const card = page.locator("article").filter({ hasText: "Convex (selbst gehostet)" });
      await card.waitFor();
      await card.getByRole("button", { name: "Projekt öffnen" }).last().click();
      const nav = page.getByRole("navigation", { name: "Convex Studio" });
      await nav.waitFor();
      convexId = new URL(page.url()).searchParams.get("id") ?? "";
      expect(convexId).not.toBe("");
      for (const label of [
        "Übersicht",
        "Daten",
        "Funktionen",
        "Dateien",
        "Logs",
        "Zeitpläne",
        "Umgebung",
        "Einstellungen",
      ])
        expect(await nav.getByRole("button", { name: label }).isEnabled()).toBe(true);
      const main = page.locator("section[aria-label='Übersicht']");
      await main.getByText("Selbst gehostet").first().waitFor();
      await main.getByText("Läuft", { exact: true }).waitFor();
      await main.getByText("Kennzahlen").waitFor();
      const stat = (label: string) =>
        main.getByText(label, { exact: true }).first().locator("xpath=..").innerText();
      await poll(
        () => stat("Tabellen"),
        (text) => /\d/.test(text),
      );
      expect(await stat("Tabellen")).toMatch(/[1-9]/);
      expect(await stat("Funktionen")).toMatch(/[1-9]/);
      expect(await stat("Cronjobs")).toMatch(/2/);
      await main.getByText("Letzte Fehler").waitFor();
      await shot(page, "convex-01-overview");
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Daten durchsuchen, filtern, Dokumente und Tabellen bearbeiten",
  async () => {
    await withPage("convex-data", async (page) => {
      const main = await openConvex(page, "data", "Daten");
      const messages = main.getByRole("button", { name: /^messages\b/ });
      await messages.waitFor();
      const started = performance.now();
      await messages.click();
      await main
        .getByText(/^Message \d+:/)
        .first()
        .waitFor();
      timings.convexDataFirstData = Math.round(performance.now() - started);
      expect(timings.convexDataFirstData).toBeLessThan(2000);
      await main.getByText("Seite 1 · 50 Dokumente").waitFor();
      await main.getByRole("button", { name: "Weiter" }).click();
      await main.getByText(/^Seite 2 · \d+ Dokumente$/).waitFor();
      await main.getByRole("button", { name: "Zurück" }).click();
      await main.getByText("Seite 1 · 50 Dokumente").waitFor();
      await shot(page, "convex-02-data-messages");

      await main.getByRole("button", { name: "Filter", exact: true }).click();
      await main.getByRole("button", { name: "Bedingung" }).click();
      await main.getByLabel("Feld", { exact: true }).fill("author");
      await main.getByLabel("Wert", { exact: true }).fill('"Grace"');
      await main.getByRole("button", { name: "Anwenden" }).click();
      await main.getByText("Seite 1 · 20 Dokumente").waitFor();
      expect(await main.locator("tbody").getByText("Ada", { exact: true }).count()).toBe(0);
      await shot(page, "convex-03-data-filter");
      await main.getByRole("button", { name: "Zurücksetzen" }).click();
      await main.getByText("Seite 1 · 50 Dokumente").waitFor();

      await main.getByRole("tab", { name: "Schema & Indizes" }).click();
      await main.getByText("by_author", { exact: true }).waitFor();
      await main.getByText("search_body", { exact: true }).waitFor();
      await shot(page, "convex-04-data-schema");

      await main.getByLabel("Tabelle erstellen").click();
      const create = page.getByRole("dialog");
      await create.getByLabel("Tabellenname").fill(convexTable);
      await create.getByRole("button", { name: "Erstellen" }).click();
      await create.waitFor({ state: "detached" });
      await main.getByRole("heading", { name: convexTable }).waitFor();
      await main.getByText("Die Tabelle ist leer.").waitFor();

      await main.getByRole("button", { name: "Dokument", exact: true }).click();
      const insert = page.getByRole("dialog");
      await fillJson(page, insert, '[{"label": "eins", "n": 1}, {"label": "zwei", "n": 2}]');
      await insert.getByRole("button", { name: "Einfügen" }).click();
      await insert.waitFor({ state: "detached" });
      await main.getByText("2 Dokumente eingefügt.").waitFor();
      await main.getByText(/^"?eins"?$/).waitFor();

      await main.getByText(/^"?zwei"?$/).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Bearbeiten" }).click();
      const edit = page.getByRole("dialog", { name: /Dokument bearbeiten/ });
      await fillJson(page, edit, '{"label": "zwei geändert", "n": 22}');
      await edit.getByRole("button", { name: "Speichern", exact: true }).click();
      await edit.waitFor({ state: "detached" });
      await page.getByRole("dialog").getByText("zwei geändert").first().waitFor();
      await shot(page, "convex-05-data-document");
      await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
      await confirmAlert(page, "Löschen");
      await page.keyboard.press("Escape");
      await main.getByText("zwei geändert").waitFor({ state: "detached" });
      await main.getByText(/^"?eins"?$/).waitFor();

      await main.getByLabel("Tabellenaktionen").click();
      await page.getByRole("menuitem", { name: "Tabelle leeren…" }).click();
      let alert = page.getByRole("alertdialog");
      await alert.getByRole("textbox").fill(convexTable);
      await alert.getByRole("button", { name: "Leeren" }).click();
      await alert.waitFor({ state: "detached" });
      await main.getByText("1 Dokumente gelöscht.").waitFor();
      await main.getByText("Die Tabelle ist leer.").waitFor();

      await main.getByLabel("Tabellenaktionen").click();
      await page.getByRole("menuitem", { name: "Tabelle löschen…" }).click();
      alert = page.getByRole("alertdialog");
      await alert.getByRole("textbox").fill(convexTable);
      await alert.getByRole("button", { name: "Tabelle löschen" }).click();
      await alert.waitFor({ state: "detached" });
      await main.getByRole("button", { name: new RegExp(`^${convexTable}\\b`) }).waitFor({
        state: "detached",
      });
    });
  },
  240_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Funktionen ausführen und HTTP-Aktionen testen",
  async () => {
    await withPage("convex-functions", async (page) => {
      const main = await openConvex(page, "functions", "Funktionen");
      await main.getByText("messages.js").first().waitFor();

      await selectFunction(main, "messages", "list");
      const started = await runFunction(page, main, '{"author": "Ada"}');
      await main.getByText("Erfolgreich").waitFor();
      timings.convexFunctionRun = Math.round(performance.now() - started);
      expect(timings.convexFunctionRun).toBeLessThan(2000);
      await main.getByText('"author": "Ada"').first().waitFor();
      await main.getByText("Erfolgreich").scrollIntoViewIfNeeded();
      await shot(page, "convex-06-function-query");

      await selectFunction(main, "messages", "sendLater");
      await runFunction(
        page,
        main,
        '{"author": "l8db-ui", "body": "geplant von l8db", "delayMs": 3600000}',
      );
      await main.getByText("Erfolgreich").waitFor();

      await selectFunction(main, "actions", "logSomething");
      await runFunction(page, main, '{"note": "l8db-ui"}');
      await main.getByText("Erfolgreich").waitFor();
      await main.getByText(/logSomething called.*l8db-ui/).waitFor();
      await main.getByText(/this is a warning/).waitFor();
      await main.getByText(/this is a warning/).scrollIntoViewIfNeeded();
      await shot(page, "convex-07-function-action");

      await selectFunction(main, "actions", "fail");
      await runFunction(page, main, "{}");
      await main.getByText("Fehler", { exact: true }).first().waitFor();
      await main
        .getByText(/intentional failure from actions:fail/)
        .first()
        .waitFor();
      await main
        .getByText(/intentional failure from actions:fail/)
        .first()
        .scrollIntoViewIfNeeded();
      await shot(page, "convex-08-function-error");

      await main.getByRole("tab", { name: /HTTP-Aktionen/ }).click();
      await main.getByRole("button", { name: /GET\s*\/messages/ }).click();
      await main.getByRole("button", { name: "Senden" }).click();
      await main.getByText("HTTP 200").waitFor();
      await main
        .getByText(/geplant|Message \d+/)
        .first()
        .waitFor();
      await main.getByText("HTTP 200").scrollIntoViewIfNeeded();
      await shot(page, "convex-09-http");
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Logs live verfolgen, filtern, pausieren",
  async () => {
    await withPage("convex-logs", async (page) => {
      const main = await openConvex(page, "logs", "Logs");
      await main.getByLabel("Logs durchsuchen").waitFor();
      await main.getByRole("switch").first().click();
      expect(await main.getByRole("switch").first().getAttribute("aria-checked")).toBe("true");
      await runLogAction("live");
      await main.getByText("actions:logSomething").first().waitFor({ timeout: 30_000 });
      await shot(page, "convex-10-logs-live");

      await main.getByLabel("Logs durchsuchen").fill("live");
      await poll(
        () => main.getByText("messages:cronTick").count(),
        (count) => count === 0,
      );
      expect(await main.getByText("messages:cronTick").count()).toBe(0);
      await main.getByText("actions:logSomething").first().click();
      const detail = page.getByRole("dialog");
      await detail.getByText(/logSomething called.*live/).waitFor();
      await shot(page, "convex-11-logs-detail");
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });

      await main.getByRole("switch").first().click();
      expect(await main.getByRole("switch").first().getAttribute("aria-checked")).toBe("false");
      const rows = main.getByText("actions:logSomething");
      const paused = await rows.count();
      await runLogAction("live-paused");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await rows.count()).toBe(paused);
      expect(await main.getByRole("button", { name: "Aktualisieren" }).isEnabled()).toBe(true);
      await main.getByRole("button", { name: "Aktualisieren" }).click();
      await poll(
        () => rows.count(),
        (count) => count > paused,
      );
      expect(await rows.count()).toBeGreaterThan(paused);
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Dateien hochladen, ansehen, herunterladen, löschen",
  async () => {
    await withPage("convex-files", async (page) => {
      const main = await openConvex(page, "files", "Dateien");
      await main.locator("tbody tr").first().waitFor();
      const before = await main.locator("tbody tr").count();
      await main.getByRole("button", { name: "Hochladen" }).click();
      await page.getByText("1 Datei(en) hochgeladen.").waitFor();
      await poll(
        () => main.locator("tbody tr").count(),
        (count) => count === before + 1,
      );
      const row = main.locator("tbody tr").filter({ hasText: "19 B" }).first();
      const id = (await row.locator("button[title]").first().getAttribute("title")) ?? "";
      expect(id).not.toBe("");
      await row.locator("button[title]").first().click();
      await page.getByText("l8db browser upload").waitFor();
      await shot(page, "convex-12-files-preview");
      await page.getByLabel("Dateivorschau schließen").click();

      await main.getByLabel(`Aktionen für ${id}`).click();
      await page.getByRole("menuitem", { name: "Herunterladen" }).click();
      await page.getByText("Datei gespeichert.").waitFor();

      await main.getByLabel(`Aktionen für ${id}`).click();
      await page.getByRole("menuitem", { name: "Löschen" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
      await page.getByText("1 Datei(en) gelöscht.").waitFor();
      await main.getByLabel(`Aktionen für ${id}`).waitFor({ state: "detached" });
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: geplante Funktion abbrechen, Cron-Jobs ansehen",
  async () => {
    await withPage("convex-schedules", async (page) => {
      const main = await openConvex(page, "schedules", "Zeitpläne");
      const row = main.locator("tr").filter({ hasText: "messages:insertInternal" });
      await row.first().waitFor();
      const before = await row.count();
      await shot(page, "convex-13-schedules-jobs");
      await row.first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("l8db-ui").waitFor();
      await page.keyboard.press("Escape");
      const target = main.locator("tr").filter({ hasText: "messages:insertInternal" }).first();
      await target.getByRole("button", { name: "Abbrechen" }).click();
      await page.getByRole("alertdialog").getByRole("button").last().click();
      await page.getByRole("alertdialog").waitFor({ state: "detached" });
      await poll(
        () => row.count(),
        (count) => count === before - 1,
      );
      expect(await row.count()).toBe(before - 1);

      await main.getByRole("tab", { name: "Cron-Jobs" }).click();
      await main.getByText("tick every minute").waitFor();
      await main.getByText("daily cleanup").waitFor();
      await main.getByText("tick every minute").click();
      await main.getByText("Letzte Läufe").waitFor();
      await shot(page, "convex-14-schedules-crons");
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Umgebungsvariablen anlegen, anzeigen, ändern, importieren, löschen",
  async () => {
    await withPage("convex-environment", async (page) => {
      const main = await openConvex(page, "environment", "Umgebung");
      await main.getByLabel("Variablenname").fill("L8DB_UI_LAB");
      await main.getByLabel("Variablenwert").fill("eins");
      await main.getByLabel("Variablenwert").press("Enter");
      const row = main.locator("tr").filter({ hasText: "L8DB_UI_LAB" });
      await row.waitFor();
      await main.getByLabel("L8DB_UI_LAB anzeigen").click();
      await row.getByText("eins", { exact: true }).waitFor();
      await main.getByLabel("L8DB_UI_LAB bearbeiten").click();
      await main.getByLabel("Neuer Wert für L8DB_UI_LAB").fill("zwei");
      await main.getByLabel("Neuer Wert für L8DB_UI_LAB").press("Enter");
      await poll(
        async () => {
          if (await main.getByLabel("L8DB_UI_LAB anzeigen").isVisible())
            await main.getByLabel("L8DB_UI_LAB anzeigen").click();
          return row.innerText();
        },
        (text) => text.includes("zwei"),
      );
      await row.getByText("zwei", { exact: true }).waitFor();
      await main.getByLabel("L8DB_UI_LAB verbergen").click();
      await main.getByLabel("L8DB_UI_LAB bearbeiten").click();
      await poll(
        () => main.getByLabel("Neuer Wert für L8DB_UI_LAB").inputValue(),
        (value) => value === "zwei",
      );
      await row.getByLabel("Abbrechen").click();

      await main.getByRole("button", { name: ".env importieren" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel(".env-Inhalt")
        .fill('L8DB_UI_A=1\nexport L8DB_UI_B="mit leerzeichen"\n');
      await dialog.getByRole("button", { name: "Importieren" }).click();
      await dialog.waitFor({ state: "detached" });
      await main.getByText("L8DB_UI_A", { exact: true }).waitFor();
      await main.getByText("L8DB_UI_B", { exact: true }).waitFor();
      await main.getByLabel("L8DB_UI_B anzeigen").click();
      await main.getByText("mit leerzeichen", { exact: true }).waitFor();
      await shot(page, "convex-15-environment");

      for (const name of ["L8DB_UI_LAB", "L8DB_UI_A", "L8DB_UI_B"]) {
        await main.getByLabel(`${name} löschen`).click();
        await confirmAlert(page, "Löschen");
        await main.getByText(name, { exact: true }).waitFor({ state: "detached" });
      }
    });
  },
  180_000,
);

test.skipIf(!enabled || !convexUrl)(
  "Convex Studio: Einstellungen, Pause, Export, trennen",
  async () => {
    await withPage("convex-settings", async (page) => {
      const main = await openConvex(page, "settings", "Einstellungen");
      await main.getByText("Snapshot-Export").waitFor();
      await main.getByText("Gefahrenzone").waitFor();
      await shot(page, "convex-16-settings");

      await main.getByRole("button", { name: "Pausieren" }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("127.0.0.1:3210");
      await dialog.getByRole("button", { name: "Pausieren" }).click();
      await page.getByText("Deployment pausiert.").waitFor();
      await main.getByRole("button", { name: "Fortsetzen" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Fortsetzen" }).click();
      await page.getByText("Deployment läuft wieder.").waitFor();
      await main.getByRole("button", { name: "Pausieren" }).waitFor();

      const started = main.getByText(/^Gestartet /);
      const previous = (await started.count()) ? await started.innerText() : "";
      await main.getByRole("button", { name: "Export anfordern" }).click();
      await poll(
        async () => ((await started.count()) ? await started.innerText() : ""),
        (text) => text !== "" && text !== previous,
      );
      await main.getByText("Letzter Export: Bereit").waitFor({ timeout: 60_000 });
      await main.getByRole("button", { name: "Herunterladen" }).click();
      await page.getByText(/Snapshot gespeichert unter/).waitFor();
      await shot(page, "convex-17-settings-export");

      await main.getByRole("button", { name: "Trennen" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("127.0.0.1:3210");
      await dialog.getByRole("button", { name: "Trennen" }).click();
      await page.getByRole("heading", { name: "Convex verbinden" }).waitFor();
      await shot(page, "convex-18-disconnected");
    });
  },
  240_000,
);
