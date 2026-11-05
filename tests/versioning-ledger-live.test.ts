import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installVersioningLab, versioningAppUrl } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;

for (const kind of ["postgres", "oracle"] as const) {
  test.skipIf(!enabled)(
    `${kind}: change ledger for mass rollouts, hotfix merges, data releases and legacy customers`,
    async () => {
      if (!enabled) throw new Error("L8DB_VERSIONING_LAB is required");
      const settings = JSON.parse(await readFile(enabled, "utf8"));
      const repo = `${settings.root}/ledger-${kind}-${Date.now()}`;
      await mkdir(repo);
      execFileSync("git", ["init", "-b", "main", repo]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
      execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.setDefaultTimeout(30000);
      try {
        await installVersioningLab(page, repo);
        await page.goto(`${versioningAppUrl}/versioning`);
        const result = await page.evaluate(
          async ({ repo, kind }) => {
            const { runLedgerScenario } = await import(
              "/tests/fixtures/versioning-ledger-scenario.ts"
            );
            return runLedgerScenario(repo, kind);
          },
          { repo, kind },
        );
        console.log(JSON.stringify(result));
        expect(result).toMatchObject({
          masse: [["v2", "v3", "v4"], ["v3", "v4"], ["v4"]],
          again: 0,
          adopted: true,
          migrated: true,
          confirmRequired: true,
          euros: 1,
          hotfixShown: "1 Update offen",
          hotfixSteps: ["v6/m"],
          catchUpSteps: ["v5/m", "v5.1/m", "v6/m"],
          versions: ["v11", "v11", "v11"],
          single: {
            distributed: [
              ["2026-11-05-index-waehrung"],
              ["2026-11-05-index-waehrung"],
              ["2026-11-05-index-waehrung"],
            ],
            twice: true,
            v11: [0, 0, 0],
            indexes: [1, 1, 1],
            ticks: [1, 1, 1],
          },
          align: {
            open: ["v9/schema", "v9/code", "v9/data", "v10/code"],
            variances: ["invoices", "price"],
            aligned: [expect.stringMatching(/^angleichen-c-/)],
            after: ["v9/schema", "v9/code", "v9/data", "v10/code"],
            variancesLeft: 0,
            track: "main",
            shown: "Aktuell",
            price: true,
          },
          code: {
            skipA: ["v9/code:skip"],
            applyB: ["v9/code:apply"],
            skipped: ["v9/code"],
            usd: [1, 1],
            tickedA: 3,
            tickedB: 3,
            again: 0,
            priceB: true,
          },
          drift: {
            planned: ["price"],
            refused: true,
            keptA: true,
            report: ["a:price", "b:price"],
            varianceRun: ["v10/code:variance"],
            varianceKept: true,
            withoutOverride: ["price"],
            override: ["v10/code:override"],
            overriddenB: true,
          },
          legacy: {
            decisions: ["v2/m", "v3/m", "v5.1/m", "v5/m", "v7/m"],
            proposed: ["invoices", "price"],
            noSql: true,
            run: ["v8/m"],
            variancesKept: true,
            recorded: 2,
            shown: "Aktuell",
          },
        });
      } finally {
        await browser.close();
      }
    },
    300000,
  );
}
