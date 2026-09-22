import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = Bun.YAML.parse(
  readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
) as {
  jobs: { prepare: { steps: { name?: string; run?: string }[] } };
};
const gate = workflow.jobs.prepare.steps.find(
  (step) => step.name === "Prüfe Release-Secrets",
)?.run;
if (!gate) throw new Error("Release credential gate is missing");

const credentials = {
  RELEASE_PR_TOKEN: "test-release-token",
  TAURI_SIGNING_PRIVATE_KEY: "test-updater-key",
  APPLE_CERTIFICATE: "test-certificate",
  APPLE_CERTIFICATE_PASSWORD: "test-export-password",
  APPLE_ID: "test@example.invalid",
  APPLE_PASSWORD: "test-app-specific-password",
};

describe("production release credentials", () => {
  for (const name of Object.keys(credentials)) {
    test(`blocks publication when ${name} is missing`, () => {
      const result = Bun.spawnSync(["bash", "-e", "-c", gate], {
        env: { PATH: process.env.PATH, ...credentials, [name]: "" },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.toString()).toContain(name);
    });
  }

  test("allows a fully configured release to proceed", () => {
    const result = Bun.spawnSync(["bash", "-e", "-c", gate], {
      env: { PATH: process.env.PATH, ...credentials },
    });
    expect(result.exitCode).toBe(0);
  });
});
