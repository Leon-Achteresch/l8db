import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  compareVersions,
  git,
  newestRelease,
  nextVersion,
  outputs,
  releases,
  semanticBump,
  VERSION_PATTERN,
} from "./release-utils.mjs";

export const RELEASE_FILES = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "CHANGELOG.md",
  ".github/release-plan.json",
];

function withoutVersion(file, text) {
  text = text.replace(/\r\n?/g, "\n").trim();
  if (file.endsWith(".json")) {
    const value = JSON.parse(text);
    delete value.version;
    return JSON.stringify(value);
  }
  return file.endsWith("Cargo.lock")
    ? text.replace(/(\[\[package\]\]\r?\nname = "l8db"\r?\nversion = ")[^"]+(")/, "$1VERSION$2")
    : text.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/, "$1VERSION$2");
}

export function validPlan(version) {
  if (!existsSync(".github/release-plan.json")) return false;
  const plan = JSON.parse(readFileSync(".github/release-plan.json", "utf8"));
  if (plan.version !== version || plan.format !== 1 || !/^[a-f0-9]{40}$/.test(plan.sourceSha))
    return false;
  try {
    git("merge-base", "--is-ancestor", plan.sourceSha, "HEAD");
    const changed = [
      ...git("diff", "--name-only", plan.sourceSha).split("\n"),
      ...git("ls-files", "--others", "--exclude-standard").split("\n"),
    ].filter(Boolean);
    if (changed.some((file) => !RELEASE_FILES.includes(file))) return false;
    for (const file of RELEASE_FILES.slice(0, 4)) {
      if (
        withoutVersion(file, git("show", `${plan.sourceSha}:${file}`)) !==
        withoutVersion(file, readFileSync(file, "utf8"))
      )
        return false;
    }
    return (
      plan.changelogSha256 ===
      createHash("sha256").update(readFileSync("CHANGELOG.md")).digest("hex")
    );
  } catch {
    return false;
  }
}

export function releaseState(version, sha, all, ready) {
  assert(VERSION_PATTERN.test(version), "Invalid source version");
  const latest = newestRelease(all);
  const existing = all.find((release) => release.tag_name === `v${version}`);
  if (existing && !existing.draft && existing.target_commitish === sha) {
    return { mode: "complete", version, previous_tag: "", release_id: existing.id };
  }
  if (latest && compareVersions(version, latest.tag_name.slice(1)) <= 0)
    return { mode: "prepare", version };
  if (!ready) return { mode: "prepare", version };
  if (existing && existing.target_commitish !== sha)
    return { mode: "prepare", version, reason: "reserved-by-another-commit" };
  return {
    mode: "publish",
    version,
    previous_tag: latest?.tag_name ?? "",
    release_id: existing?.id ?? "",
  };
}

function main() {
  const command = process.argv[2];
  execFileSync(process.execPath, ["scripts/version.mjs", "check"], { stdio: "inherit" });
  const source = JSON.parse(readFileSync("package.json", "utf8")).version;
  const all = releases();
  const sha = git("rev-parse", "HEAD");
  const state = releaseState(source, sha, all, validPlan(source));
  if (command === "status") {
    outputs(state);
    console.log(`Release v${source}: ${state.mode}`);
    return;
  }
  assert.equal(command, "prepare", "Usage: release-plan.mjs status|prepare");
  assert.equal(git("status", "--porcelain"), "", "Prepare a release from a clean checkout");
  const requested = ["patch", "minor", "major"].includes(process.env.RELEASE_BUMP)
    ? process.env.RELEASE_BUMP
    : "";
  if (
    state.mode !== "prepare" &&
    !process.env.RELEASE_VERSION &&
    ["", "patch"].includes(requested)
  ) {
    outputs({ changed: "false", version: source });
    return;
  }
  const reserved = all.sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  let floor = reserved?.tag_name.slice(1);
  if (existsSync(".github/release-plan.json")) {
    const planned = JSON.parse(readFileSync(".github/release-plan.json", "utf8")).version;
    if (VERSION_PATTERN.test(planned) && (!floor || compareVersions(planned, floor) > 0))
      floor = planned;
  }
  const previous = newestRelease(all)?.tag_name;
  let version = process.env.RELEASE_VERSION;
  if (!version && requested) version = nextVersion(source, floor, requested);
  if (!version) {
    const base = previous?.slice(1) ?? source;
    const range = previous ? `${previous}..${sha}` : sha;
    const messages = git("log", range, "--no-merges", "--format=%B%x00")
      .split("\0")
      .map((message) => message.trim());
    version = nextVersion(base, base, semanticBump(messages, base));
    if (floor && compareVersions(version, floor) <= 0) version = nextVersion(floor, floor);
  }
  assert(VERSION_PATTERN.test(version), "Release version must be stable SemVer");
  assert(
    !floor || compareVersions(version, floor) > 0,
    "Release version must exceed every published or reserved version",
  );
  if (previous) git("merge-base", "--is-ancestor", previous, sha);
  execFileSync(process.execPath, ["scripts/version.mjs", "set", version], { stdio: "inherit" });
  const date = new Date().toISOString().slice(0, 10);
  execFileSync(
    process.execPath,
    [
      ".github/scripts/generate-changelog.mjs",
      "--next",
      version,
      "--head",
      sha,
      "--date",
      date,
      ...(previous ? ["--previous", previous] : []),
    ],
    { stdio: "inherit" },
  );
  writeFileSync(
    ".github/release-plan.json",
    `${JSON.stringify({ format: 1, version, sourceSha: sha, previousTag: previous ?? null, date, changelogSha256: createHash("sha256").update(readFileSync("CHANGELOG.md")).digest("hex") }, null, 2)}\n`,
  );
  outputs({ changed: "true", version });
  console.log(`Prepared release PR for v${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
