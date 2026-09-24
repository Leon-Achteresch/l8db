import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;

test.skipIf(!enabled)(
  "customer schemas and connections remain isolated in a real PostgreSQL rollout",
  async () => {
    if (!enabled) throw new Error("Lab settings missing");
    const settings = JSON.parse(await readFile(enabled, "utf8"));
    const repo = `${settings.root}/multischema-${Date.now()}`;
    const suffix = repo.split("multischema-").at(-1)?.replace(/\D/g, "").slice(-8);
    await mkdir(repo);
    execFileSync("git", ["init", repo]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
    execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    try {
      await installVersioningLab(page, repo);
      await page.goto("http://localhost:1420/versioning");
      const panel = await page.locator("#versioning-panel").boundingBox();
      expect(panel !== null && panel.width > 800).toBe(true);
      await page.getByRole("textbox", { name: "Projektname", exact: true }).fill("Kundenprodukt");
      await page.getByRole("button", { name: "Versionierungsprojekt anlegen" }).click();
      const result = await page.evaluate(async (repo) => {
        const { runMultischemaScenario } = await import(
          "/tests/fixtures/versioning-multischema-scenario.ts"
        );
        return runMultischemaScenario(repo);
      }, repo);
      expect(result).toEqual({
        duplicateBlocked: true,
        before: [null, null, null],
        afterCanary: [
          { amount: 11, note: true },
          { amount: 22, note: false },
          { amount: 33, note: false },
        ],
        final: [
          { amount: 11, note: true },
          { amount: 22, note: true },
          { amount: 33, note: true },
        ],
        publicUntouched: true,
        uiSchema: `tenant_ui_${suffix}`,
        releases: ["v2", "v2", "v2"],
      });
      await page.getByRole("button", { name: "Versionierung aktualisieren" }).click();
      await page.getByRole("tab", { name: "Datenbanken", exact: true }).click();
      await page.getByText("Kunde Nord", { exact: true }).waitFor();
      await page.getByText("tenant_nord_", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Kundenziel hinzufügen" }).click();
      await page.getByRole("textbox", { name: "Kundenname" }).fill("Kunde UI");
      await page.getByRole("combobox", { name: "Zielverbindung" }).click();
      await page.getByRole("option", { name: "Development" }).click();
      await page.locator('input[aria-label="Zielschema"]').fill(result.uiSchema);
      await page.getByRole("checkbox", { name: "Produktionsumgebung" }).uncheck();
      await page.getByRole("button", { name: "Kundenziel speichern" }).click();
      await page.getByRole("button", { name: "Baseline v2 prüfen" }).click();
      await page
        .locator("#versioning-panel")
        .getByRole("status")
        .getByText("Baseline geprüft und zugeordnet")
        .waitFor();
      await page.getByRole("button", { name: "Kundenziel hinzufügen" }).click();
      await page.getByRole("textbox", { name: "Kundenname" }).fill("Alias Nord");
      await page.getByRole("combobox", { name: "Zielverbindung" }).click();
      await page.getByRole("option", { name: "Development" }).click();
      await page.locator('input[aria-label="Zielschema"]').fill(`tenant_nord_${suffix}`);
      await page.getByRole("button", { name: "Kundenziel speichern" }).click();
      await page
        .getByRole("alert")
        .getByText("Kunde Nord verwendet bereits dieselbe Datenbank und dasselbe Schema", {
          exact: false,
        })
        .waitFor();
    } finally {
      await browser.close();
    }
  },
  120000,
);
