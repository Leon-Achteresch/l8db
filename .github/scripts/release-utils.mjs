import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export const REPOSITORY = "Leon-Achteresch/l8db";
export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left, right) {
  assert(VERSION_PATTERN.test(left) && VERSION_PATTERN.test(right), "Invalid stable version");
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function nextVersion(current, latest, bump = "patch") {
  assert(VERSION_PATTERN.test(current), "Invalid source version");
  assert(["patch", "minor", "major"].includes(bump), "Invalid release bump");
  const base = latest && compareVersions(latest, current) > 0 ? latest : current;
  if (bump === "patch" && latest && compareVersions(current, latest) > 0) return current;
  const parts = base.split(".").map(BigInt);
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index] += 1n;
  for (let next = index + 1; next < 3; next++) parts[next] = 0n;
  return parts.join(".");
}

export function semanticBump(messages, version) {
  let bump = "patch";
  for (const message of messages) {
    const match = message.match(/^([a-z]+)(\([^)]*\))?(!)?:/);
    if (match?.[3] || /^BREAKING[ -]CHANGE:/m.test(message))
      return version.startsWith("0.") ? "minor" : "major";
    if (match?.[1] === "feat") bump = "minor";
  }
  return bump;
}

export function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

export function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

export function api(route) {
  return JSON.parse(gh("api", route));
}

export function releases() {
  return JSON.parse(gh("api", "--paginate", "--slurp", `repos/${REPOSITORY}/releases?per_page=100`))
    .flat()
    .filter(
      (release) =>
        release.tag_name.startsWith("v") &&
        VERSION_PATTERN.test(release.tag_name.slice(1)) &&
        !release.prerelease,
    );
}

export function newestRelease(all) {
  return all
    .filter((release) => !release.draft)
    .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
}

export function outputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    const delimiter = randomUUID();
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${key}<<${delimiter}\n${String(value)}\n${delimiter}\n`,
    );
  }
}
