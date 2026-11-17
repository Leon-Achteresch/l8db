import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
});
afterAll(async () => {
  await browser?.close();
});

async function open(scenario: string, width = 1100, theme = "dark") {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/tests/fixtures/csv-file-check.html?scenario=${scenario}&theme=${theme}`);
  await page.getByRole("button", { name: "CSV-Datei prüfen" }).waitFor();
  return { page, errors };
}

const status = (page: Page) => page.locator("section [role=status]").first();
const commands = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __csvCheck: { calls: { cmd: string }[] } }).__csvCheck.calls
      .map((call) => call.cmd)
      .filter((cmd) => !cmd.startsWith("plugin:")),
  );
const setScenario = (page: Page, value: string) =>
  page.evaluate((next) => {
    (window as unknown as { __csvCheck: { scenario: string } }).__csvCheck.scenario = next;
  }, value);

type Fixture = {
  emit: (id: string, rows: number) => void;
  jobs: { jobId: string; fail: (error: string) => void; settle: (report: unknown) => void }[];
};

run(
  "inline counts are unknown until a matching event; scope, mapping and unmount reject late events/errors",
  async () => {
    const { page, errors } = await open("manual");
    for (const action of [
      "Quelle wechseln",
      "Zuordnung und Optionen wechseln",
      "Kontext wechseln",
      "Prüffeld umschalten",
    ]) {
      await page.getByRole("button", { name: "CSV-Datei prüfen" }).click();
      await page.waitForFunction(
        () => (window as unknown as { __csvCheck: Fixture }).__csvCheck.jobs.length === 1,
      );
      expect(await status(page).textContent()).toContain("Datensätze unbekannt");
      const oldId = await page.evaluate(() => {
        const f = (window as unknown as { __csvCheck: Fixture }).__csvCheck;
        const id = f.jobs[0].jobId;
        f.emit("foreign-import-job", 999999);
        return id;
      });
      expect(await status(page).textContent()).toContain("Datensätze unbekannt");
      await page.evaluate(
        (id) => (window as unknown as { __csvCheck: Fixture }).__csvCheck.emit(id, 8192),
        oldId,
      );
      await page.waitForFunction(() =>
        document
          .querySelector('section [role="status"]')
          ?.textContent?.includes("8.192 Datensätze gelesen"),
      );
      await page.getByRole("button", { name: action, exact: true }).click();
      if (action === "Prüffeld umschalten")
        await page.getByRole("button", { name: action, exact: true }).click();
      await page.getByRole("button", { name: "CSV-Datei prüfen" }).click();
      await page.waitForFunction(
        () => (window as unknown as { __csvCheck: Fixture }).__csvCheck.jobs.length === 2,
      );
      await page.evaluate((id) => {
        const f = (window as unknown as { __csvCheck: Fixture }).__csvCheck;
        f.emit(id, 999999);
        f.jobs.find((job) => job.jobId === id)?.fail("late stale file error");
      }, oldId);
      await page.waitForFunction(
        () => (window as unknown as { __csvCheck: Fixture }).__csvCheck.jobs.length === 1,
      );
      expect(await status(page).textContent()).toContain("Datensätze unbekannt");
      expect(await page.getByText("late stale file error").count()).toBe(0);
      await page.evaluate(() => {
        const f = (window as unknown as { __csvCheck: Fixture }).__csvCheck;
        f.jobs[0].settle({
          status: "changed",
          checked_rows: 0,
          error_count: 0,
          issues: [],
          source_size: 1,
          source_modified_ms: 1,
        });
      });
      await page.getByText("Datei während der Prüfung geändert · Ergebnis verworfen").waitFor();
      await page.getByRole("button", { name: "Quelle wechseln" }).click();
      await page.getByRole("button", { name: "CSV-Datei prüfen" }).waitFor();
    }
    expect(
      (await commands(page)).every((command) =>
        ["check_csv_file", "cancel_execution"].includes(command),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  },
);

run("keyboard runs, cancels and restarts without showing an old report", async () => {
  const { page, errors } = await open("slow");
  const action = page.locator("section button").last();
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(status(page).textContent()).resolves.toContain("Prüft die ganze Datei");
  expect(await action.textContent()).toBe("Prüfung abbrechen");
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Prüfung abbrechen");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.getByText("Abgebrochen · keine Freigabe").waitFor();
  expect(await page.locator("section > p").first().textContent()).toMatch(
    /^[\d.]+ Datensätze gelesen/,
  );
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Erneut prüfen");
  await setScenario(page, "findings");
  await page.keyboard.press("Enter");
  expect(await status(page).textContent()).toContain("Prüft die ganze Datei");
  expect(await page.locator("section > p").count()).toBe(0);
  await status(page).getByText("1.234 Befunde").waitFor();
  expect(await page.locator("section tbody tr").count()).toBe(10);
  expect(await page.getByText("+1.224 weitere Befunde").count()).toBe(1);
  expect(await commands(page)).toEqual(["check_csv_file", "cancel_execution", "check_csv_file"]);
  expect(errors).toEqual([]);
  await page.close();
});

run("source change discards the running check and ignores a late clean answer", async () => {
  const { page, errors } = await open("stuck");
  await page.getByRole("button", { name: "CSV-Datei prüfen" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __csvCheck: { jobs: unknown[] } }).__csvCheck.jobs.length === 1,
  );
  await page.getByRole("button", { name: "Quelle wechseln" }).click();
  await page.getByRole("button", { name: "CSV-Datei prüfen" }).waitFor();
  await page.getByRole("button", { name: "Alte Antwort spät liefern" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __csvCheck: { late: number } }).__csvCheck.late,
    ),
  ).toBe(1);
  await page.waitForTimeout(200);
  expect(await status(page).textContent()).toContain("ohne Datenbankzugriff");
  expect(await page.getByText("Keine Struktur- oder NULL-Befunde").count()).toBe(0);
  expect((await commands(page)).filter((cmd) => cmd === "cancel_execution").length).toBeGreaterThan(
    0,
  );
  expect(errors).toEqual([]);
  await page.close();
});

run("terminal states stay distinct and findings fit a narrow light panel", async () => {
  const { page, errors } = await open("incomplete", 380, "light");
  const action = page.locator("section button").last();
  const expected: [string, string][] = [
    ["incomplete", "Unvollständig · Datei nicht bis zum Ende lesbar"],
    ["changed", "Datei während der Prüfung geändert · Ergebnis verworfen"],
    ["error", "Prüfung fehlgeschlagen"],
    ["clean", "Keine Struktur- oder NULL-Befunde"],
    ["findings", "1.234 Befunde"],
  ];
  for (const [scenario, title] of expected) {
    await setScenario(page, scenario);
    await action.click();
    await status(page).getByText(title).waitFor();
  }
  expect(await page.getByRole("button", { name: "Datei neu wählen" }).count()).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  const box = page.locator("section .overflow-x-auto");
  expect(await box.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await page.getByRole("button", { name: "Datei neu wählen" }).click();
  await page.getByRole("button", { name: "CSV-Datei prüfen" }).waitFor();
  expect(errors).toEqual([]);
  await page.close();
});
