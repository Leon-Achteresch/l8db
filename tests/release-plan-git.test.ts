import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "l8db-release-plan-"));
  directories.push(directory);
  const root = join(directory, "repo");
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  copyFileSync("scripts/version.mjs", join(root, "scripts/version.mjs"));
  copyFileSync(
    ".github/scripts/generate-changelog.mjs",
    join(root, ".github/scripts/generate-changelog.mjs"),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "l8db", version: "0.8.0", dependencies: { test: "1.0.0" } }),
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "0.8.0", identifier: "com.leon.l8db" }),
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    '[package]\nname = "l8db"\nversion = "0.8.0"\n',
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "l8db"\nversion = "0.8.0"\n',
  );
  writeFileSync(join(root, "app.ts"), 'export const value = "before";\n');
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  const commit = (message: string) => {
    git("add", ".");
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.invalid",
      "commit",
      "-qm",
      message,
    );
  };
  commit("feat: baseline");
  git("tag", "v0.8.24");
  writeFileSync(join(root, "app.ts"), 'export const value = "after";\n');
  commit("fix: candidate change");
  const sha = git("rev-parse", "HEAD");
  const all = [
    {
      id: 1,
      tag_name: "v0.8.24",
      draft: false,
      prerelease: false,
      target_commitish: git("rev-parse", "v0.8.24"),
    },
  ];
  const data = join(directory, "releases.json");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(data, JSON.stringify([all]));
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node\nprocess.stdout.write(require('node:fs').readFileSync(${JSON.stringify(data)}, 'utf8'));\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    GITHUB_OUTPUT: "",
    RELEASE_VERSION: "",
    RELEASE_BUMP: "",
  };
  const run = (command: string, additional: Record<string, string> = {}) =>
    spawnSync("node", [resolve(".github/scripts/release-plan.mjs"), command], {
      cwd: root,
      env: { ...env, ...additional },
      encoding: "utf8",
    });
  const valid = () =>
    execFileSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import {validPlan} from ${JSON.stringify(pathToFileURL(resolve(".github/scripts/release-plan.mjs")).href)}; process.stdout.write(String(validPlan('0.8.25')));`,
      ],
      { cwd: root, encoding: "utf8" },
    ) === "true";
  return { root, run, valid, commit, sha, git };
}

test("release preparation records source, notes and all versions before building", () => {
  const value = fixture();
  expect(value.valid()).toBe(false);
  const prepared = value.run("prepare");
  expect(prepared.stderr).toBe("");
  expect(prepared.status).toBe(0);
  const plan = JSON.parse(readFileSync(join(value.root, ".github/release-plan.json"), "utf8"));
  expect(plan).toMatchObject({ version: "0.8.25", previousTag: "v0.8.24", sourceSha: value.sha });
  expect(readFileSync(join(value.root, "CHANGELOG.md"), "utf8")).toContain("candidate change");
  value.commit("chore(release): prepare v0.8.25");
  expect(value.valid()).toBe(true);
  expect(value.run("status").stdout).toContain("publish");
  expect(value.run("prepare").stdout).not.toContain("Prepared release PR");
}, 30000);

for (const file of ["app.ts", "package.json", "CHANGELOG.md", "new-app.ts"]) {
  test(`a release plan becomes invalid when ${file} changes`, () => {
    const value = fixture();
    expect(value.run("prepare").status).toBe(0);
    value.commit("chore(release): prepare");
    if (file === "package.json") {
      const path = join(value.root, file);
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      pkg.dependencies.test = "2.0.0";
      writeFileSync(path, JSON.stringify(pkg));
    } else writeFileSync(join(value.root, file), "changed\n");
    expect(value.valid()).toBe(false);
    if (file !== "new-app.ts") {
      value.commit("fix: later change");
      expect(value.valid()).toBe(false);
    }
  }, 30000);
}

test("stale requested versions and dirty checkouts fail without bumping source files", () => {
  const value = fixture();
  const file = join(value.root, "package.json");
  const before = readFileSync(file, "utf8");
  expect(value.run("prepare", { RELEASE_VERSION: "0.8.24" }).status).not.toBe(0);
  expect(readFileSync(file, "utf8")).toBe(before);
  writeFileSync(join(value.root, "app.ts"), "dirty\n");
  expect(value.run("prepare").status).not.toBe(0);
  expect(readFileSync(file, "utf8")).toBe(before);
}, 30000);

test("new changes cannot reuse a candidate while its original build is still running", () => {
  const value = fixture();
  expect(value.run("prepare").status).toBe(0);
  value.commit("chore(release): reserve v0.8.25");
  writeFileSync(join(value.root, "app.ts"), "later change\n");
  value.commit("fix: change during compilation");
  expect(value.run("prepare").status).toBe(0);
  expect(
    JSON.parse(readFileSync(join(value.root, ".github/release-plan.json"), "utf8")).version,
  ).toBe("0.8.26");
}, 30000);
