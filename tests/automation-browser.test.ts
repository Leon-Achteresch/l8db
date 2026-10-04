import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";
import {
  type AutomationSeed,
  automationStorage,
  BACKUP_TASK,
  CSV_REPORT,
  EXTRA,
  mockAutomationInit,
} from "./fixtures/automation-browser";

const ENABLED = Boolean(process.env.L8DB_AUTOMATION_BROWSER);
const ARTIFACTS = resolve("test-artifacts/automation");

async function createServer() {
  const root = resolve("dist");
  const policy = Object.entries(config.app.security.csp)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = resolve(root, `.${new URL(request.url).pathname}`);
      if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
      if (path !== root && (await Bun.file(path).exists())) return new Response(Bun.file(path));
      return new Response(Bun.file(resolve(root, "index.html")), {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": policy },
      });
    },
  });
}

async function launchBrowser(): Promise<Browser> {
  return (process.env.L8DB_AUTOMATION_BROWSER === "webkit" ? webkit : chromium).launch();
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (cmd) =>
      (
        (
          window as unknown as {
            __automationCalls: { cmd: string; args: Record<string, unknown> }[];
          }
        ).__automationCalls ?? []
      ).filter((entry) => entry.cmd === cmd),
    command,
  );
}

async function shot(page: Page, theme: string, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${ARTIFACTS}/${name}-${theme}.png` });
}

async function flow(theme: "light" | "dark") {
  mkdirSync(ARTIFACTS, { recursive: true });
  const server = await createServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: theme,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const seed: AutomationSeed = {
    storage: automationStorage(theme),
    tasks: [],
    runs: [],
    alerts: [],
  };
  try {
    await page.addInitScript(mockAutomationInit, seed);
    await page.goto(`http://localhost:${server.port}/connections`);
    const link = page.locator('a[href="/automation"]').first();
    await link.waitFor({ timeout: 15000 });
    await link.click();

    await page.getByTestId("automation-empty-state").waitFor({ timeout: 10000 });
    expect((await calls(page, "automation_sync_connections")).length).toBeGreaterThan(0);
    await shot(page, theme, "01-empty");

    await page.getByTestId("automation-new-task").click();
    await page.getByRole("menuitem", { name: /Aus Vorlage/ }).click();
    const picker = page.getByTestId("automation-template-picker");
    await picker.waitFor({ timeout: 5000 });
    expect(await picker.locator("[data-template-id]").count()).toBeGreaterThanOrEqual(7);
    await shot(page, theme, "02-template-picker");
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached", timeout: 5000 });

    await page.getByTestId("automation-empty-blank").click();
    const editor = page.getByTestId("automation-task-editor");
    await editor.waitFor({ timeout: 5000 });
    const list = page.getByTestId("automation-task-list");
    await list
      .locator("[data-task-draft]")
      .getByText("nicht gespeichert")
      .waitFor({ timeout: 5000 });
    await editor.getByLabel("Name des Tasks").fill(CSV_REPORT.name);
    await list.locator("[data-task-draft]").getByText(CSV_REPORT.name).waitFor({ timeout: 5000 });

    await page.getByTestId("automation-add-step").click();
    await page.getByRole("option", { name: /Exportieren/ }).click();
    const steps = page.getByTestId("automation-step-list");
    await steps.getByText("Exportieren").first().waitFor({ timeout: 5000 });
    await editor.getByLabel("Name des Schritts").fill("Umsätze exportieren");
    await steps.getByText("Umsätze exportieren").waitFor({ timeout: 5000 });
    expect(await steps.locator("[data-step-button]").count()).toBe(1);
    await shot(page, theme, "03-editor-step");

    await editor.getByRole("tab", { name: /^Zeitplan/ }).click();
    await editor.getByRole("button", { name: "Zeitplan hinzufügen" }).click();
    const preview = page.getByTestId("automation-schedule-preview");
    await preview.waitFor({ timeout: 5000 });
    await preview.getByText("Nächste Läufe").waitFor({ timeout: 5000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="automation-schedule-preview"] ol li').length >=
          5 &&
        !document.querySelector('[data-testid="automation-schedule-preview"] ol[aria-busy="true"]'),
      undefined,
      { timeout: 5000 },
    );
    expect((await calls(page, "automation_preview_schedule")).length).toBeGreaterThan(0);
    await shot(page, theme, "04-editor-schedule");

    await page.getByTestId("automation-save").click();
    await page.waitForFunction(
      () =>
        (
          (window as unknown as { __automationCalls: { cmd: string }[] }).__automationCalls ?? []
        ).some((entry) => entry.cmd === "automation_save_task"),
      undefined,
      { timeout: 5000 },
    );
    const savedTask = (await calls(page, "automation_save_task")).at(-1)?.args.task as {
      id: string;
      name: string;
      steps: { name: string; action: { type: string } }[];
      schedules: unknown[];
    };
    expect(savedTask.name).toBe(CSV_REPORT.name);
    expect(savedTask.steps.map((entry) => [entry.name, entry.action.type])).toEqual([
      ["Umsätze exportieren", "export"],
    ]);
    expect(savedTask.schedules.length).toBe(1);
    const csvRow = list.locator(`[data-task-row="${savedTask.id}"]`);
    await csvRow.waitFor({ timeout: 5000 });
    expect(await list.locator("[data-task-draft]").count()).toBe(0);

    await page.getByTestId("automation-run").click();
    await page.waitForFunction(
      (id) =>
        (
          (
            window as unknown as {
              __automationCalls: { cmd: string; args: { input: { taskId: string } } }[];
            }
          ).__automationCalls ?? []
        ).some((entry) => entry.cmd === "automation_run_task" && entry.args.input.taskId === id),
      savedTask.id,
      { timeout: 5000 },
    );
    await csvRow.getByText(/läuft/i).waitFor({ timeout: 5000 });
    expect(await page.getByText("ist nicht gespeichert").count()).toBe(0);
    await shot(page, theme, "05-editor-running");
    const editorRun = String(
      await (
        await page.waitForFunction(
          () => {
            const store = JSON.parse(localStorage.getItem("l8db.tasks") ?? "{}") as {
              state?: { tasks?: { id: string }[] };
            };
            return (
              store.state?.tasks?.find((entry) => entry.id.startsWith("automation:"))?.id ?? false
            );
          },
          undefined,
          { timeout: 5000 },
        )
      ).jsonValue(),
    ).replace("automation:", "");
    expect(editorRun).toStartWith("run-live-");
    await page.evaluate((id) => {
      (window as unknown as { __automationFinish: (value: string) => void }).__automationFinish(id);
    }, editorRun);
    await csvRow.getByText(/läuft/i).waitFor({ state: "detached", timeout: 5000 });
    await editor.getByLabel("Editor schließen").click();

    await page.evaluate((extra) => {
      (window as unknown as { __automationAdd: (value: unknown) => void }).__automationAdd(extra);
    }, EXTRA);
    await list.locator(`[data-task-row="${BACKUP_TASK.id}"]`).waitFor({ timeout: 5000 });
    await page.getByTestId("automation-planning").waitFor({ timeout: 5000 });
    await shot(page, theme, "06-list");

    const search = page.getByLabel("Tasks durchsuchen");
    await search.fill("Bericht");
    await expect(list.locator(`[data-task-row="${BACKUP_TASK.id}"]`).count()).resolves.toBe(0);
    await expect(csvRow.count()).resolves.toBe(1);
    await shot(page, theme, "07-list-filtered");
    await search.fill("");

    await csvRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Ausführen" }).click();
    await page.waitForFunction(
      () =>
        (
          (window as unknown as { __automationCalls: { cmd: string }[] }).__automationCalls ?? []
        ).filter((entry) => entry.cmd === "automation_run_task").length >= 2,
      undefined,
      { timeout: 5000 },
    );
    await csvRow.getByText(/läuft/i).waitFor({ timeout: 5000 });
    const runId = String(
      await (
        await page.waitForFunction(
          (previous) => {
            const store = JSON.parse(localStorage.getItem("l8db.tasks") ?? "{}") as {
              state?: { tasks?: { id: string; status: string }[] };
            };
            return (
              store.state?.tasks?.find(
                (entry) =>
                  entry.id.startsWith("automation:") && entry.id !== `automation:${previous}`,
              )?.id ?? false
            );
          },
          editorRun,
          { timeout: 5000 },
        )
      ).jsonValue(),
    ).replace("automation:", "");
    expect(runId).toStartWith("run-live-");
    await shot(page, theme, "08-running");

    await page.evaluate((id) => {
      (window as unknown as { __automationFinish: (value: string) => void }).__automationFinish(id);
    }, runId);
    await page.waitForFunction(
      (id) => {
        const store = JSON.parse(localStorage.getItem("l8db.tasks") ?? "{}") as {
          state?: { tasks?: { id: string; status: string; title: string }[] };
        };
        const entry = store.state?.tasks?.find((item) => item.id === `automation:${id}`);
        return (
          entry?.status === "success" && entry.title === "Automatisierung · Täglicher CSV-Bericht"
        );
      },
      runId,
      { timeout: 5000 },
    );

    await page.getByRole("tab", { name: /Verlauf/ }).click();
    const history = page.getByTestId("automation-history");
    await history.waitFor({ timeout: 5000 });
    await history.locator(`[data-run-id="${runId}"]`).click();
    const timeline = page.getByTestId("automation-run-timeline");
    await timeline.waitFor({ timeout: 5000 });
    expect(await timeline.getByText("Umsätze exportieren").count()).toBeGreaterThan(0);
    await shot(page, theme, "09-history");
    await history.locator('[data-run-id="run-backup-1"]').click();
    await page
      .getByTestId("automation-run-detail")
      .getByText("pg_dump: Verbindung zum Server verloren.")
      .first()
      .waitFor({ timeout: 5000 });
    await shot(page, theme, "10-history-failed");

    await page.getByRole("tab", { name: /Alarme/ }).click();
    const alerts = page.getByTestId("automation-alerts");
    await alerts.waitFor({ timeout: 5000 });
    const triggered = alerts.locator('[data-alert-step="step-alert"]');
    await triggered.waitFor({ timeout: 5000 });
    expect(await triggered.getAttribute("data-alert-status")).toBe("triggered");
    await shot(page, theme, "11-alerts");
    await triggered.getByTestId("automation-alert-mute").click();
    await page.getByRole("menuitem", { name: /8 Stunden/ }).click();
    await page.waitForFunction(
      () =>
        (
          (
            window as unknown as {
              __automationCalls: { cmd: string; args: { until: string | null } }[];
            }
          ).__automationCalls ?? []
        ).some((entry) => entry.cmd === "automation_set_alert_mute" && entry.args.until),
      undefined,
      { timeout: 5000 },
    );
    await triggered.getByText(/Stumm/).first().waitFor({ timeout: 5000 });
    await shot(page, theme, "12-alerts-muted");

    await page.getByRole("tab", { name: /Einstellungen/ }).click();
    const settings = page.getByTestId("automation-settings");
    await settings.waitFor({ timeout: 5000 });
    await page.getByTestId("automation-background-status").waitFor({ timeout: 5000 });
    await shot(page, theme, "13-settings");
    await page.getByTestId("automation-smtp-add").click();
    const dialog = page.getByTestId("automation-smtp-dialog");
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByLabel("Name").fill("Büro-Mailserver");
    await dialog.getByLabel("Server").fill("smtp.example.com");
    await dialog.getByLabel("Benutzer").fill("reports@example.com");
    await dialog.getByLabel("Passwort").fill("s3cret");
    await dialog.getByLabel("Absender").fill("reports@example.com");
    await shot(page, theme, "14-smtp-dialog");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    const saved = await calls(page, "automation_save_settings");
    const lastSettings = saved.at(-1)?.args.settings as
      | { smtpProfiles: { id: string; name: string }[] }
      | undefined;
    const profiles = lastSettings?.smtpProfiles ?? [];
    expect(profiles.map((profile) => profile.name)).toEqual(["Büro-Mailserver"]);
    expect(JSON.stringify(saved.at(-1)?.args)).not.toContain("s3cret");
    const secrets = await calls(page, "store_secret");
    expect(
      secrets.some(
        (entry) =>
          entry.args.account === `automation:smtp:${profiles[0].id}` &&
          entry.args.secret === "s3cret",
      ),
    ).toBe(true);
    await settings.getByText("Büro-Mailserver").waitFor({ timeout: 5000 });
    await shot(page, theme, "15-settings-smtp");

    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}

test.skipIf(!ENABLED)("Automatisierung: Abläufe im hellen Design", () => flow("light"), 120000);
test.skipIf(!ENABLED)("Automatisierung: Abläufe im dunklen Design", () => flow("dark"), 120000);
