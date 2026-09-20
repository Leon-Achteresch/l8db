import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;

for (const engine of ["chromium", "webkit"] as const) {
  test.skipIf(!enabled)(
    `${engine}: real Git, PostgreSQL single database and customer fleet deployments`,
    async () => {
      if (!enabled) throw new Error("L8DB_VERSIONING_LAB is required");
      const settings = JSON.parse(await readFile(enabled, "utf8"));
      const repo = `${settings.root}/postgres-${engine}-${Date.now()}`;
      await mkdir(repo);
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
      execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
      const browser = await (engine === "chromium" ? chromium : webkit).launch();
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.setDefaultTimeout(15000);
      try {
        await installVersioningLab(page, repo);
        await page.goto("http://localhost:1420/versioning");
        await page.getByRole("button", { name: "Repository öffnen", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Projektname", exact: true })
          .fill("Invoice Product");
        await page
          .getByRole("button", { name: "Versionierungsprojekt anlegen", exact: true })
          .click();
        await page.getByRole("button", { name: "Kundendatenbanken", exact: true }).waitFor();
        const result = await page.evaluate(
          async ({ repo }) => {
            const { runPostgresScenario } = await import(
              "/tests/fixtures/versioning-postgres-scenario.ts"
            );
            return runPostgresScenario(repo);
          },
          { repo },
        );
        expect(result).toEqual({
          stalePlanBlocked: true,
          concurrentBlocked: true,
          lengths: [2, 1],
          versions: ["v3", "v3", "v1"],
          drift: true,
          driftBlocked: true,
          failed: true,
          rollback: true,
          retryBlocked: true,
          readonlyBlocked: true,
          failureRecorded: true,
        });
        await page.getByRole("button", { name: "Versionierung aktualisieren" }).click();
        await page.getByRole("button", { name: "Kundendatenbanken", exact: true }).click();
        await page.getByRole("cell", { name: /^Kunde A/ }).waitFor();
        await page.screenshot({ path: `/tmp/l8db-versioning-${engine}-fleet.png` });
      } catch (error) {
        await page.screenshot({ path: `/tmp/l8db-versioning-${engine}-failure.png` });
        console.error(await page.locator("body").innerText());
        throw error;
      } finally {
        await browser.close();
      }
    },
    120000,
  );
}
