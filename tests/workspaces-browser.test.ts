import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "playwright";
import { seedSupabaseStudio } from "./fixtures/supabase-studio-mock";

const enabled = Boolean(process.env.L8DB_WORKSPACES_BROWSER);
const appUrl = process.env.L8DB_WORKSPACES_URL ?? "http://localhost:1420";
let browser: Browser;

beforeAll(async () => {
  if (enabled) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

test.skipIf(!enabled)(
  "workspace UI exercises grants, invites, revision conflicts, query cancellation and bounded idle results",
  async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedSupabaseStudio(page);
    await page.addInitScript(() => {
      const state = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
        __workspaceMock: {
          requests: string[];
          revision: number;
          access: string;
          cancelled: number;
        };
      };
      const original = state.__TAURI_INTERNALS__.invoke;
      const user = { id: "admin-1", email: "admin@example.test", role: "admin", active: true };
      const connection = {
        id: "source-1",
        name: "Shared DB",
        kind: "postgres",
        database: "app",
        access: "write",
        requireApproval: false,
      };
      const users = [
        user,
        { id: "member-1", email: "member@example.test", role: "member", active: true },
      ];
      const invitations: { id: string; email: string; role: string; expiresAt: number }[] = [];
      const queries = [
        {
          id: "query-1",
          connectionId: "source-1",
          name: "Saved query",
          sql: "SELECT 1",
          author: "admin-1",
          revision: 1,
        },
      ];
      let rejectQuery: ((reason: Error) => void) | undefined;
      state.__workspaceMock = { requests: [], revision: 1, access: "read", cancelled: 0 };
      state.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (command === "workspace_profiles")
          return [{ id: "profile-1", endpoint: "https://team.example.test", user }];
        if (command === "workspace_local_status") return null;
        if (command !== "workspace_request") return original(command, args);
        const request = args.request as {
          method: string;
          path: string;
          body?: Record<string, unknown>;
        };
        const { path, method, body = {} } = request;
        state.__workspaceMock.requests.push(`${method} ${path}`);
        if (path === "me") return user;
        if (path === "connections") return { items: [connection], more: false };
        if (path === "users") return { items: users, more: false };
        if (path.endsWith("/grants")) {
          if (method === "PUT") state.__workspaceMock.access = String(body.access);
          return {
            items: [
              {
                userId: "member-1",
                email: "member@example.test",
                access: state.__workspaceMock.access,
              },
            ],
            more: false,
          };
        }
        if (path === "invitations") {
          if (method === "POST") {
            invitations.push({
              id: "invitation-1",
              email: String(body.email),
              role: String(body.role),
              expiresAt: Date.now() / 1000 + 86400,
            });
            return { token: "browser-invitation" };
          }
          return { items: invitations, more: false };
        }
        if (path.startsWith("queries/") && method === "GET")
          return { ...queries[0], revision: state.__workspaceMock.revision };
        if (path === "queries") {
          if (method === "POST") {
            if (body.id && body.expectedRevision !== state.__workspaceMock.revision)
              throw new Error(
                "Die gemeinsame SQL-Abfrage wurde inzwischen geändert. Bitte neu laden.",
              );
            state.__workspaceMock.revision++;
            Object.assign(queries[0], {
              name: String(body.name),
              sql: String(body.sql),
              revision: state.__workspaceMock.revision,
            });
            return { id: "query-1", revision: state.__workspaceMock.revision };
          }
          return {
            items: queries.map(({ sql, ...query }) => ({
              ...query,
              sqlPreview: sql.slice(0, 256),
              revision: state.__workspaceMock.revision,
            })),
            more: false,
          };
        }
        if (path.endsWith("/cancel")) {
          state.__workspaceMock.cancelled++;
          rejectQuery?.(new Error("Workspace-Abfrage abgebrochen."));
          return { cancelled: true };
        }
        if (path.endsWith("/query")) {
          if (String(body.sql).includes("slow"))
            return new Promise((_, reject) => {
              rejectQuery = reject;
            });
          const columns = Array.from({ length: 121 }, (_, index) => `c${index}`);
          return {
            columns,
            rows: Array.from({ length: 1000 }, (_, row) =>
              Object.fromEntries(columns.map((column) => [column, row])),
            ),
            rows_affected: null,
            execution_time_ms: 5,
            truncated: true,
          };
        }
        if (path === "pending") return { items: [], more: false };
        if (path === "logs")
          return {
            items: [
              {
                id: 1,
                actor: user.email,
                action: "login",
                connectionId: null,
                outcome: "ok",
                createdAt: 1793826000,
              },
            ],
            more: false,
          };
        throw new Error(`Unexpected workspace request ${method} ${path}`);
      };
    });
    const started = performance.now();
    await page.goto(`${appUrl}/workspaces`);
    await page.getByRole("heading", { name: "Team-Workspaces", exact: true }).waitFor();
    await page.getByText("Shared DB", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Benutzer und Rechte" }).click();
    await page.getByRole("combobox", { name: "Verbindung für Rechteverwaltung" }).click();
    await page.getByRole("option", { name: "Shared DB" }).click();
    await page.getByRole("combobox", { name: "Verbindungsrechte von member@example.test" }).click();
    await page.getByRole("option", { name: "Lesen und Schreiben" }).click();
    await page.getByRole("tab", { name: "Einladungen", exact: true }).click();
    await page.getByLabel("E-Mail", { exact: true }).fill("new@example.test");
    await page.getByRole("button", { name: "Einladung erstellen" }).click();
    await page.getByText("browser-invitation", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Gemeinsame SQL", exact: true }).click();
    await page.getByRole("combobox", { name: "Verbindung für gemeinsame SQL-Abfrage" }).click();
    await page.getByRole("option", { name: "Shared DB" }).click();
    await page.getByRole("button", { name: "Saved query", exact: true }).click();
    await page.evaluate(() => {
      (window as unknown as { __workspaceMock: { revision: number } }).__workspaceMock.revision++;
    });
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await page.getByRole("alert").filter({ hasText: "inzwischen geändert" }).waitFor();
    await page.getByLabel("SQL", { exact: true }).fill("SELECT 'slow'");
    await page.getByRole("button", { name: "Ausführen", exact: true }).click();
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "abgebrochen" }).waitFor();
    await page.getByLabel("SQL", { exact: true }).fill("SELECT 1");
    await page.getByRole("button", { name: "Ausführen", exact: true }).click();
    const result = page.getByRole("table", { name: "Workspace SQL-Ergebnis" });
    await result.waitFor();
    expect(await result.getByRole("cell").count()).toBeLessThanOrEqual(400);
    const before = await page.evaluate(
      () =>
        (window as unknown as { __workspaceMock: { requests: string[] } }).__workspaceMock.requests
          .length,
    );
    await page.waitForTimeout(350);
    const stats = await page.evaluate(
      () =>
        (
          window as unknown as {
            __workspaceMock: { requests: string[]; access: string; cancelled: number };
          }
        ).__workspaceMock,
    );
    expect(stats.requests.length).toBe(before);
    expect(stats.access).toBe("write");
    expect(stats.cancelled).toBe(1);
    expect(errors).toEqual([]);
    console.log(
      `workspace browser: ${Math.round(performance.now() - started)}ms full journey, ${stats.requests.length} mocked workspace requests, no idle polling`,
    );
    await page.close();
  },
  120000,
);

test.skipIf(!enabled)(
  "pending approvals require complete current SQL and a different author",
  async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fullSql = Array.from(
      { length: 1000 },
      (_, index) => `UPDATE accounts SET balance = balance + 1 WHERE id = ${index};`,
    ).join("\n");
    type PendingWindow = Window & {
      __pendingBrowser: {
        mode: "missing" | "outdated" | "valid";
        requests: { method: string; path: string }[];
        approved: { id: string; sql: string }[];
      };
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    await seedSupabaseStudio(page);
    await page.addInitScript((fullSql) => {
      const state = window as PendingWindow;
      state.__pendingBrowser = { mode: "missing", requests: [], approved: [] };
      const original = state.__TAURI_INTERNALS__.invoke;
      const user = {
        id: "admin-reviewer",
        email: "reviewer@example.test",
        role: "admin",
        active: true,
      };
      const foreign = {
        id: "foreign-request",
        connectionId: "shared-db",
        author: "admin-author",
        sql: fullSql,
        status: "pending",
        createdAt: 1793826000,
      };
      const own = {
        id: "own-request",
        connectionId: "shared-db",
        author: user.id,
        sql: "DELETE FROM audit_entries;",
        status: "pending",
        createdAt: 1793826001,
      };
      state.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (command === "workspace_profiles")
          return [{ id: "pending-profile", endpoint: "https://team.example.test", user }];
        if (command === "workspace_local_status") return null;
        if (command !== "workspace_request") return original(command, args);
        const request = args.request as { method: string; path: string };
        const { method, path } = request;
        state.__pendingBrowser.requests.push({ method, path });
        if (path === "me") return user;
        if (path === "connections")
          return {
            items: [
              {
                id: "shared-db",
                name: "Shared DB",
                kind: "postgres",
                access: "write",
                requireApproval: true,
                database: "app",
              },
            ],
            more: false,
          };
        if (path === "pending")
          return {
            items: [foreign, own].map(({ sql, ...entry }) => ({
              ...entry,
              sqlPreview: sql.slice(0, 80),
            })),
            more: false,
          };
        if (path === "pending/foreign-request" && method === "GET") {
          if (state.__pendingBrowser.mode === "missing")
            throw new Error("Anfrage ist nicht mehr verfügbar.");
          if (state.__pendingBrowser.mode === "outdated")
            return { ...foreign, status: "cancelled" };
          return { ...foreign };
        }
        if (path === "pending/foreign-request/approve" && method === "POST") {
          if (state.__pendingBrowser.mode !== "valid")
            throw new Error("Ungeprüfte SQL darf nicht ausgeführt werden.");
          state.__pendingBrowser.approved.push({ id: foreign.id, sql: foreign.sql });
          foreign.status = "executed";
          return { columns: [], rows: [], rows_affected: 1000, execution_time_ms: 10 };
        }
        throw new Error(`Unexpected pending request ${method} ${path}`);
      };
    }, fullSql);
    try {
      await page.goto(`${appUrl}/workspaces`);
      await page.getByRole("tab", { name: "Freigaben", exact: true }).click();
      const foreign = page.locator("article").filter({ hasText: "UPDATE accounts" });
      const own = page.locator("article").filter({ hasText: "DELETE FROM audit_entries" });
      const approve = foreign.getByRole("button", { name: "Freigeben und ausführen", exact: true });
      await foreign.waitFor();
      expect(
        await own.getByRole("button", { name: "Freigeben und ausführen", exact: true }).count(),
      ).toBe(0);
      expect(await approve.isDisabled()).toBe(true);
      expect((await foreign.locator("pre").innerText()).length).toBeLessThan(100);
      await foreign.getByRole("button", { name: "Vollständige SQL prüfen", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "nicht mehr verfügbar" }).waitFor();
      expect(await approve.isDisabled()).toBe(true);
      await page.evaluate(() => {
        (window as PendingWindow).__pendingBrowser.mode = "outdated";
      });
      await foreign.getByRole("button", { name: "Vollständige SQL prüfen", exact: true }).click();
      await page.waitForTimeout(100);
      expect(await approve.isDisabled()).toBe(true);
      expect(
        await page.evaluate(() => (window as PendingWindow).__pendingBrowser.approved.length),
      ).toBe(0);
      await page.evaluate(() => {
        (window as PendingWindow).__pendingBrowser.mode = "valid";
      });
      const loadedAt = performance.now();
      await foreign.getByRole("button", { name: "Vollständige SQL prüfen", exact: true }).click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("pre")).some((node) =>
          node.textContent?.includes("WHERE id = 999;"),
        ),
      );
      const loadMs = performance.now() - loadedAt;
      expect(await foreign.locator("pre").innerText()).toBe(fullSql);
      expect(await approve.isEnabled()).toBe(true);
      expect(loadMs).toBeLessThan(1500);
      expect(await page.locator("article").count()).toBe(2);
      expect(await page.locator("*").count()).toBeLessThan(2500);
      await approve.click();
      await foreign.getByText("Ausgeführt", { exact: true }).waitFor();
      const stats = await page.evaluate(() => (window as PendingWindow).__pendingBrowser);
      expect(stats.approved).toEqual([{ id: "foreign-request", sql: fullSql }]);
      expect(
        stats.requests.filter(
          (request) => request.path === "pending/foreign-request" && request.method === "GET",
        ),
      ).toHaveLength(3);
      expect(stats.requests.filter((request) => request.method === "POST")).toEqual([
        { method: "POST", path: "pending/foreign-request/approve" },
      ]);
      const idle = stats.requests.length;
      await page.waitForTimeout(500);
      expect(
        await page.evaluate(() => (window as PendingWindow).__pendingBrowser.requests.length),
      ).toBe(idle);
      expect(errors).toEqual([]);
      console.log(
        JSON.stringify({
          feature: "workspace-pending-browser",
          sqlBytes: new TextEncoder().encode(fullSql).length,
          loadMs,
          articles: 2,
          detailRequests: 3,
          approvals: 1,
          requests: idle,
          idleRequests: 0,
        }),
      );
    } finally {
      await page.close();
    }
  },
  60000,
);
