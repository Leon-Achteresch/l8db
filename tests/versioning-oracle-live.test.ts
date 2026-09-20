import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;

test.skipIf(!enabled)(
  "Oracle packages: mapped customer schemas, three-way merge and failed deployment recovery",
  async () => {
    if (!enabled) throw new Error("L8DB_VERSIONING_LAB is required");
    const settings = JSON.parse(await readFile(enabled, "utf8"));
    const repo = `${settings.root}/oracle-${Date.now()}`;
    await mkdir(repo);
    execFileSync("git", ["init", repo]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
    execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    try {
      await installVersioningLab(page, repo);
      await page.goto("http://localhost:1420/versioning");
      const result = await page.evaluate(
        async ({ repo }) => {
          const { runOracleScenario } = await import(
            "/tests/fixtures/versioning-oracle-scenario.ts"
          );
          return runOracleScenario(repo);
        },
        { repo },
      );
      expect(result).toEqual({
        sourceRoundtrip: true,
        pureFiles: true,
        mappedDeployment: true,
        customerDrift: true,
        conflict: true,
        cleanMerge: true,
        failed: true,
        partial: true,
        stopped: true,
        recorded: true,
      });
    } finally {
      await browser.close();
    }
  },
  120000,
);
