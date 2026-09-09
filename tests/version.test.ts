import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("release version updates the Cargo lockfile without changing dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "l8db-version-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src-tauri"));
    copyFileSync("scripts/version.mjs", join(root, "scripts/version.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "l8db", version: "0.3.0" }));
    writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "0.3.0" }));
    writeFileSync(
      join(root, "src-tauri/Cargo.toml"),
      '[package]\nname = "l8db"\nversion = "0.3.0"\n',
    );
    const dependency = '[[package]]\nname = "other"\nversion = "1.2.3"\n';
    writeFileSync(
      join(root, "src-tauri/Cargo.lock"),
      `version = 4\n\n[[package]]\nname = "l8db"\nversion = "0.3.0"\n\n${dependency}`,
    );
    const run = (...args: string[]) =>
      execFileSync("node", [join(root, "scripts/version.mjs"), ...args], {
        encoding: "utf8",
        stdio: "pipe",
      });
    run("set", "0.3.42");
    expect(run("check")).toContain("Versions in sync");
    expect(run("check-tag", "v0.3.42")).toContain("matches version");
    const locked = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
    expect(locked).toContain('name = "l8db"\nversion = "0.3.42"');
    expect(locked).toContain(dependency);
    writeFileSync(join(root, "src-tauri/Cargo.lock"), locked.replace('"0.3.42"', '"0.3.0"'));
    expect(() => run("check")).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
