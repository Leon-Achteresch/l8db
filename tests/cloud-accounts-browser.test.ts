import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedSupabaseStudio } from "./fixtures/supabase-studio-mock";

const appUrl = process.env.L8DB_CLOUD_ACCOUNTS_BROWSER_URL;
let browser: Browser;
type CloudWindow = Window & {
  __cloudCalls: { command: string; args: Record<string, unknown> }[];
  __cloudReleaseProjects?: () => void;
  __TAURI_INTERNALS__: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

beforeAll(async () => {
  if (appUrl) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function openCloud(holdProjects = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedSupabaseStudio(page);
  await page.addInitScript(
    ({ holdProjects }) => {
      const state = window as CloudWindow;
      state.__cloudCalls = [];
      const original = state.__TAURI_INTERNALS__.invoke;
      const accounts = (["neon", "planetscale", "spacetimedb"] as const).map((provider) => ({
        id: provider,
        provider,
        label: `${provider} browser`,
        auth:
          provider === "neon" ? "api_key" : provider === "planetscale" ? "service_token" : "token",
        endpoint: null,
        identity: provider === "spacetimedb" ? "browser-identity" : null,
        created_at: "2026-11-01T00:00:00Z",
      }));
      const created = (provider: string, name: string) => ({
        id: `${provider}-browser-connection`,
        name,
        provider_id: provider,
        kind:
          provider === "planetscale"
            ? "mysql"
            : provider === "spacetimedb"
              ? "spacetimedb"
              : "postgres",
        connection_string:
          provider === "neon"
            ? "postgresql://neon_user@ep-browser.neon.tech/neondb?sslmode=require&channel_binding=disable&l8db_transport=neon-ws"
            : provider === "planetscale"
              ? "mysql://readonly_user@aws.connect.psdb.cloud/browser?sslmode=require"
              : "spacetimedb://token@maincloud.spacetimedb.com/gameworld",
        ssl_mode: "require",
      });
      let issued: Record<string, unknown>[] = [];
      state.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (!command.startsWith("cloud_")) return original(command, args);
        state.__cloudCalls.push({ command, args });
        switch (command) {
          case "cloud_accounts":
            return accounts;
          case "cloud_neon_organizations":
            return [];
          case "cloud_neon_projects": {
            const index = Number(args.cursor ?? 0);
            const result = {
              items: Array.from({ length: 100 }, (_, offset) => ({
                id: `project-${index * 100 + offset}`,
                name: `Project ${index * 100 + offset}`,
                region_id: "aws-eu-central-1",
                pg_version: 17,
                org_id: null,
                created_at: null,
              })),
              next_cursor: index < 19 ? String(index + 1) : null,
            };
            if (holdProjects)
              return new Promise((resolve) => {
                state.__cloudReleaseProjects = () => resolve(result);
              });
            return result;
          }
          case "cloud_neon_branches":
            return {
              items: [{ id: "main", name: "Main branch", default: false, protected: false }],
              next_cursor: null,
            };
          case "cloud_neon_databases":
            return [{ name: "neondb", owner_name: "neon_user" }];
          case "cloud_neon_roles":
            return [{ name: "neon_user", protected: false }];
          case "cloud_neon_create_connection":
            return created("neon", String((args.request as Record<string, unknown>).name));
          case "cloud_planetscale_organizations":
            return { items: [{ id: "org-1", name: "Acme organization" }], next_page: null };
          case "cloud_planetscale_databases":
            return {
              items: [
                {
                  id: "database-1",
                  name: "App database",
                  kind: "mysql",
                  ready: true,
                  default_branch: "main",
                },
              ],
              next_page: null,
            };
          case "cloud_planetscale_branches":
            return {
              items: [{ id: "branch-1", name: "Production branch", production: true, ready: true }],
              next_page: null,
            };
          case "cloud_planetscale_credentials":
            return issued;
          case "cloud_planetscale_create_credential": {
            const request = args.request as Record<string, unknown>;
            const connection = created("planetscale", String(request.connectionName));
            const credential = {
              id: "credential-1",
              kind: "mysql",
              organization: "Acme organization",
              database: "App database",
              branch: "Production branch",
              name: request.credentialName,
              username: "readonly_user",
              connection_id: connection.id,
              created_at: "2026-11-01T00:00:00Z",
            };
            issued = [credential];
            return { connection, credential };
          }
          case "cloud_spacetime_databases":
            return {
              databases: [{ identity: "identity-1", names: ["gameworld"] }],
              truncated: false,
            };
          case "cloud_spacetime_schema":
            return {
              tables: [
                {
                  name: "players",
                  columns: [{ name: "name", type_name: "String" }],
                  public: true,
                  system: false,
                  primary_key: [],
                },
              ],
              reducers: [
                {
                  name: "add_player",
                  params: [
                    { name: "name", type_name: "String" },
                    { name: "score", type_name: "U64" },
                  ],
                  lifecycle: null,
                },
              ],
            };
          case "cloud_spacetime_create_connection":
            return created("spacetimedb", String(args.name));
          case "cloud_spacetime_call_reducer":
            return { status: 204, message: null };
          default:
            throw new Error(`Unexpected cloud command ${command}`);
        }
      };
    },
    { holdProjects },
  );
  const started = performance.now();
  await page.goto(`${appUrl}/cloud-accounts`);
  await page.getByRole("heading", { name: "Cloud-Konten" }).waitFor();
  return { page, errors, started };
}

const calls = (page: Page) => page.evaluate(() => (window as CloudWindow).__cloudCalls);
const commandCalls = async (page: Page, command: string) =>
  (await calls(page)).filter((call) => call.command === command);
const persisted = (page: Page) =>
  page.evaluate(() => localStorage.getItem("l8db.connections") ?? "");

async function expectIdle(page: Page) {
  const before = (await calls(page)).length;
  await page.evaluate(() => {
    dispatchEvent(new Event("focus"));
    dispatchEvent(new Event("online"));
  });
  await page.waitForTimeout(500);
  expect((await calls(page)).length).toBe(before);
}

test.skipIf(!appUrl)(
  "Neon project pagination keeps 500 records and creates a password-free WebSocket connection",
  async () => {
    const { page, errors, started } = await openCloud();
    try {
      await page.getByRole("button", { name: "Project 99", exact: true }).waitFor();
      const openMs = performance.now() - started;
      expect(openMs).toBeLessThan(8000);
      const samples: number[] = [];
      for (let index = 1; index < 20; index++) {
        const next = performance.now();
        await page.getByRole("button", { name: "Mehr laden", exact: true }).click();
        await page
          .getByRole("button", { name: `Project ${index * 100 + 99}`, exact: true })
          .waitFor();
        samples.push(performance.now() - next);
        expect(
          await page.getByRole("button", { name: /^Project \d+$/ }).count(),
        ).toBeLessThanOrEqual(500);
      }
      expect(await page.getByRole("button", { name: /^Project \d+$/ }).count()).toBe(500);
      expect(await page.getByRole("button", { name: "Project 0", exact: true }).count()).toBe(0);
      const domNodes = await page.locator("*").count();
      expect(domNodes).toBeLessThan(6000);
      await page.getByRole("button", { name: "Project 1999", exact: true }).click();
      await page.getByRole("button", { name: "Main branch", exact: true }).click();
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).click();
      await page.getByRole("option", { name: "neondb", exact: true }).click();
      await page.getByRole("combobox", { name: "Rolle", exact: true }).click();
      await page.getByRole("option", { name: "neon_user", exact: true }).click();
      await page.getByRole("combobox", { name: "Transport", exact: true }).click();
      await page
        .getByRole("option", { name: "WebSocket über HTTPS (Port 443)", exact: true })
        .click();
      await page.getByText(/Channel-Binding wird für diesen Transport deaktiviert/).waitFor();
      await page.getByLabel("Name der Verbindung", { exact: true }).fill("Neon WebSocket browser");
      await page.getByRole("button", { name: "Verbindung anlegen", exact: true }).click();
      await page.waitForFunction(() =>
        (localStorage.getItem("l8db.connections") ?? "").includes("neon-browser-connection"),
      );
      const storage = await persisted(page);
      expect(storage).toContain("l8db_transport=neon-ws");
      expect(storage).toContain("channel_binding=disable");
      const saved = JSON.parse(storage).state.connections.find(
        (entry: { id: string }) => entry.id === "neon-browser-connection",
      );
      expect(new URL(saved.connectionString).password).toBe("");
      expect(saved.connectionString).not.toContain("password=");
      const request = (await commandCalls(page, "cloud_neon_create_connection"))[0].args
        .request as Record<string, unknown>;
      expect(request).toMatchObject({
        projectId: "project-1999",
        branchId: "main",
        database: "neondb",
        role: "neon_user",
        transport: "neon-ws",
      });
      expect(await commandCalls(page, "cloud_neon_projects")).toHaveLength(20);
      expect(await commandCalls(page, "cloud_neon_branches")).toHaveLength(1);
      expect(await commandCalls(page, "cloud_neon_databases")).toHaveLength(1);
      expect(await commandCalls(page, "cloud_neon_roles")).toHaveLength(1);
      expect(await commandCalls(page, "cloud_neon_create_connection")).toHaveLength(1);
      await expectIdle(page);
      samples.sort((a, b) => a - b);
      const medianMs = samples[9];
      const p95Ms = samples[18];
      expect(medianMs).toBeLessThan(750);
      expect(p95Ms).toBeLessThan(2000);
      expect(errors).toEqual([]);
      await reportScenario("cloud-neon-browser", {
        openMs,
        pages: 20,
        retainedProjects: 500,
        domNodes,
        medianMs,
        p95Ms,
        projectRequests: 20,
        idleRequests: 0,
      });
    } finally {
      await page.close();
    }
  },
  120000,
);

test.skipIf(!appUrl)(
  "PlanetScale requires explicit confirmation before issuing real credentials",
  async () => {
    const { page, errors } = await openCloud();
    try {
      await page.getByRole("button", { name: "planetscale browser", exact: false }).click();
      await page.getByRole("button", { name: "Acme organization", exact: true }).click();
      await page.getByRole("button", { name: "App database", exact: false }).click();
      await page.getByRole("button", { name: "Production branch", exact: false }).click();
      await page.getByRole("button", { name: "Lesende Zugangsdaten anlegen", exact: true }).click();
      let dialog = page.getByRole("dialog");
      expect(await dialog.getByRole("button", { name: "Anlegen und verbinden" }).isDisabled()).toBe(
        true,
      );
      await dialog.getByLabel("Name der Verbindung in l8db").fill("PlanetScale browser");
      await dialog.getByLabel("Name der Verbindung in l8db").press("Enter");
      expect(await commandCalls(page, "cloud_planetscale_create_credential")).toHaveLength(0);
      await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
      expect(await commandCalls(page, "cloud_planetscale_create_credential")).toHaveLength(0);
      await page.getByRole("button", { name: "Lesende Zugangsdaten anlegen", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("checkbox").check();
      await dialog.getByLabel("Name bei PlanetScale (optional)").fill("browser_readonly");
      await dialog.getByRole("button", { name: "Anlegen und verbinden" }).click();
      await dialog.waitFor({ state: "hidden" });
      const issued = await commandCalls(page, "cloud_planetscale_create_credential");
      expect(issued).toHaveLength(1);
      expect(issued[0].args.request).toMatchObject({
        confirmed: true,
        credentialName: "browser_readonly",
        organization: "Acme organization",
        database: "App database",
        branch: "Production branch",
      });
      const storage = await persisted(page);
      expect(storage).toContain("planetscale-browser-connection");
      expect(
        new URL(
          JSON.parse(storage).state.connections.find(
            (entry: { id: string }) => entry.id === "planetscale-browser-connection",
          ).connectionString,
        ).password,
      ).toBe("");
      await expectIdle(page);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!appUrl)(
  "SpacetimeDB reducer sends typed arguments only after confirmation",
  async () => {
    const { page, errors } = await openCloud();
    try {
      await page.getByRole("button", { name: "spacetimedb browser", exact: false }).click();
      await page.getByRole("button", { name: "gameworld", exact: true }).click();
      await page.getByText("players", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Aufrufen", exact: true }).click();
      let dialog = page.getByRole("dialog");
      expect(
        await dialog.getByRole("button", { name: "Ausführen", exact: true }).isDisabled(),
      ).toBe(true);
      await dialog.getByLabel("name (String)", { exact: true }).fill("Ada");
      await dialog.getByLabel("score (U64)", { exact: true }).fill("42");
      await dialog.getByLabel("score (U64)", { exact: true }).press("Enter");
      expect(await commandCalls(page, "cloud_spacetime_call_reducer")).toHaveLength(0);
      await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page.getByRole("button", { name: "Aufrufen", exact: true }).click();
      dialog = page.getByRole("dialog");
      expect(await dialog.getByRole("checkbox").isChecked()).toBe(false);
      await dialog.getByLabel("name (String)", { exact: true }).fill("Ada");
      await dialog.getByLabel("score (U64)", { exact: true }).fill("42");
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Ausführen", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const reducers = await commandCalls(page, "cloud_spacetime_call_reducer");
      expect(reducers).toHaveLength(1);
      expect(reducers[0].args).toMatchObject({
        accountId: "spacetimedb",
        database: "gameworld",
        reducer: "add_player",
        args: ["Ada", 42],
        confirmed: true,
      });
      expect(await commandCalls(page, "cloud_spacetime_schema")).toHaveLength(1);
      await expectIdle(page);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test.skipIf(!appUrl)(
  "switching accounts ignores an abandoned Neon project response and remains idle",
  async () => {
    const { page, errors } = await openCloud(true);
    try {
      await page.waitForFunction(() => Boolean((window as CloudWindow).__cloudReleaseProjects));
      await page.getByRole("button", { name: "planetscale browser", exact: false }).click();
      await page.getByRole("button", { name: "Acme organization", exact: true }).waitFor();
      await page.evaluate(() => (window as CloudWindow).__cloudReleaseProjects?.());
      await page.waitForTimeout(100);
      expect(await page.getByRole("button", { name: "Project 0", exact: true }).count()).toBe(0);
      expect(await commandCalls(page, "cloud_neon_projects")).toHaveLength(1);
      await expectIdle(page);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);
