import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, type Request } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;
for (const kind of ["postgres", "oracle"] as const) {
  test.skipIf(!enabled)(
    `${kind}: production data checks, fleet preflight and recovery`,
    async () => {
      if (!enabled) throw new Error("Lab settings missing");
      const settings = JSON.parse(await readFile(enabled, "utf8"));
      const repo = `${settings.root}/operations-${kind}-${Date.now()}`;
      await mkdir(repo);
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
      execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000);
      const pending = new Map<Request, string>();
      page.on("request", (request) => {
        if (request.url() !== "http://127.0.0.1:55449/") return;
        const body = request.postDataJSON();
        pending.set(request, `${body.command}:${body.args?.request?.action ?? ""}`);
      });
      page.on("requestfinished", (request) => pending.delete(request));
      page.on("requestfailed", (request) => pending.delete(request));
      try {
        await installVersioningLab(page, repo);
        await page.goto("http://localhost:1420/versioning");
        const scenario = page.evaluate(
          async ({ repo, kind }) => {
            const { runOperationalScenario } = await import(
              "/tests/fixtures/versioning-operations-scenario.ts"
            );
            return runOperationalScenario(repo, kind);
          },
          { repo, kind },
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          scenario,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Scenario timed out; pending: ${[...pending.values()].join(", ")}`),
                ),
              80000,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        expect(result).toEqual({
          expiryBlocked: true,
          pauseBlocked: true,
          pinBlocked: true,
          variantBlocked: true,
          endpointBlocked: true,
          duplicateBlocked: true,
          fleetBlocked: true,
          noPartialStart: true,
          historicalIsolation: true,
          schemaContextCorrect: true,
          postconditionBlocked: true,
          dataRolledBack: true,
          boundedExecution: true,
          partialDdlRecorded: true,
          oracleConstraintDrift: kind === "oracle" ? true : null,
        });
        await page
          .getByRole("button", { name: "Versionierung aktualisieren", exact: true })
          .click();
        await page.getByRole("tab", { name: "Datenbanken", exact: true }).click();
        await page.getByRole("button", { name: "Aktionen: Customer 2", exact: true }).click();
        await page.getByText("Update-Regeln", { exact: true }).click();
        await page.getByRole("checkbox", { name: "Updates pausieren", exact: true }).check();
        await page.getByRole("button", { name: "Regeln speichern", exact: true }).click();
        await page.getByText("main · Pausiert", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByTestId("versioning-badge").getByText("1", { exact: true }).waitFor();
        await page.getByRole("tab", { name: "Releases", exact: true }).click();
        await page.getByRole("button", { name: "Release vorbereiten", exact: true }).click();
        await page.getByRole("button", { name: "Betriebsplan und Prüfungen", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Betriebsplan", exact: true })
          .fill("App-Kompatibilität und Session-Wechsel geprüft.");
        await page.getByRole("button", { name: "Nachprüfung hinzufügen", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Nachprüfung 1: SQL", exact: true })
          .fill(kind === "postgres" ? "SELECT 0" : "SELECT 0 FROM dual");
        await page.keyboard.press("Escape");
        const panel = page.locator("#versioning-panel");
        await panel.getByRole("button", { name: "Versionierung schließen", exact: true }).click();
        await page.locator("header button[aria-controls='versioning-panel']").click();
        await page.getByRole("button", { name: "Betriebsplan und Prüfungen", exact: true }).click();
        expect(
          await page.getByRole("textbox", { name: "Betriebsplan", exact: true }).inputValue(),
        ).toContain("Session-Wechsel");
        const safety = page.getByRole("dialog", {
          name: "Betriebsplan und Prüfungen",
          exact: true,
        });
        await page.screenshot({
          path: `/tmp/l8db-versioning-safety-${kind}.png`,
          animations: "disabled",
        });
        const bounds = await safety.boundingBox();
        expect(bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= 1001).toBe(true);
      } finally {
        await browser.close();
      }
    },
    120000,
  );
}
