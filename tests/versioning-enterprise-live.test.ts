import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;
for (const kind of ["postgres", "oracle"] as const) {
  test.skipIf(!enabled)(
    `${kind}: background execution, structural commit guard and recovery ownership`,
    async () => {
      if (!enabled) throw new Error("Lab settings missing");
      const settings = JSON.parse(await readFile(enabled, "utf8"));
      const repo = `${settings.root}/enterprise-${kind}-${Date.now()}`;
      await mkdir(repo);
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
      execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await installVersioningLab(page, repo);
        await page.goto("http://localhost:1420/versioning");
        await page.evaluate(
          async ({ repo, kind }) => {
            const { runOperationalScenario } = await import(
              "/tests/fixtures/versioning-operations-scenario.ts"
            );
            await runOperationalScenario(repo, kind);
          },
          { repo, kind },
        );
        const started = await page.evaluate(
          async ({ repo, kind }) => {
            const { startEnterpriseScenario } = await import(
              "/tests/fixtures/versioning-enterprise-scenario.ts"
            );
            return startEnterpriseScenario(repo, kind);
          },
          { repo, kind },
        );
        expect(started.creationSchemaCorrect).toBe(true);
        expect(started.executionLockBlocksRecovery).toBe(true);
        expect(started.structureMismatchBlocked).toBe(true);
        expect(started.structureOutcomeCorrect).toBe(true);
        expect(started.duplicateRunBlocked).toBe(true);
        await page.reload();
        const finished = await page.evaluate(
          async ({ repo, kind, started }) => {
            const { finishEnterpriseScenario } = await import(
              "/tests/fixtures/versioning-enterprise-scenario.ts"
            );
            return finishEnterpriseScenario(repo, kind, started);
          },
          { repo, kind, started },
        );
        expect(finished).toEqual({ backgroundSurvivedReload: true, durableJournal: true });
      } finally {
        await browser.close();
      }
    },
    150000,
  );
}
