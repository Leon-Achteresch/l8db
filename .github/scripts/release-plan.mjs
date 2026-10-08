import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  api,
  buildEquivalent,
  compareVersions,
  git,
  newestRelease,
  nextVersion,
  outputs,
  REPOSITORY,
  releases,
  semanticBump,
} from "./release-utils.mjs";

export const COMPILED_ARTIFACTS = ["macos-arm64", "macos-x64", "linux", "windows"].map(
  (platform) => `compiled-${platform}`,
);

export function releaseState(sha, all, messages) {
  const published = all.find((release) => !release.draft && release.target_commitish === sha);
  if (published)
    return { mode: "complete", version: published.tag_name.slice(1), previous_tag: "" };
  const previous = newestRelease(all)?.tag_name ?? "";
  const base = previous.slice(1) || "0.0.0";
  const bump = semanticBump(messages, base);
  if (!bump) return { mode: "skip", version: "", previous_tag: previous };
  return { mode: "publish", version: nextVersion(base, base, bump), previous_tag: previous };
}

export function previousCanary(stable, canaries) {
  const base = newestRelease(stable)?.tag_name.slice(1) ?? "0.0.0";
  return newestRelease(
    canaries.filter(
      (release) => compareVersions(release.tag_name.slice(1).split("-")[0], base) > 0,
    ),
  );
}

export function canaryState(sha, stable, canaries, messages, messagesSinceCanary) {
  const published = canaries.find((release) => !release.draft && release.target_commitish === sha);
  if (published)
    return { mode: "complete", version: published.tag_name.slice(1), previous_tag: "" };
  const previous = newestRelease(stable)?.tag_name ?? "";
  const base = previous.slice(1) || "0.0.0";
  const bump = semanticBump(messages, base);
  if (!bump || !semanticBump(messagesSinceCanary, base))
    return { mode: "skip", version: "", previous_tag: previous };
  const target = nextVersion(base, base, bump);
  const counter = Math.max(
    0,
    ...canaries
      .filter((release) => !release.draft && release.tag_name.startsWith(`v${target}-canary.`))
      .map((release) => Number(release.tag_name.split(".").pop())),
  );
  return { mode: "publish", version: `${target}-canary.${counter + 1}`, previous_tag: previous };
}

function commitMessages(previous, sha) {
  return git("log", previous ? `${previous}..${sha}` : sha, "--no-merges", "--format=%B%x00")
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
}

function plan(canary, sha, stable, canaries) {
  const previous = newestRelease(stable)?.tag_name;
  if (!canary) {
    if (previous) git("merge-base", "--is-ancestor", previous, sha);
    return releaseState(sha, stable, commitMessages(previous, sha));
  }
  const last = previousCanary(stable, canaries)?.tag_name ?? previous;
  return canaryState(
    sha,
    stable,
    canaries,
    commitMessages(previous, sha),
    commitMessages(last, sha),
  );
}

function assertStableMerged(tag, sha) {
  const missing = git(
    "log",
    "--no-merges",
    "--format=%h %s",
    `${sha}..${tag}`,
    "--",
    ".",
    ":(exclude)packaging",
  );
  assert(
    !missing,
    `${tag} has commits missing on canary, merge main into development:\n${missing}`,
  );
}

function reusableRun(canary, sha, stable, canaries, version) {
  const runs = api(
    `repos/${REPOSITORY}/actions/workflows/release.yml/runs?branch=${canary ? "canary" : "main"}&status=completed&per_page=20`,
  ).workflow_runs;
  for (const run of runs) {
    try {
      if (
        [...stable, ...canaries].some(
          (release) => !release.draft && release.target_commitish === run.head_sha,
        )
      )
        continue;
      if (!buildEquivalent(run.head_sha, sha)) continue;
      if (plan(canary, run.head_sha, stable, canaries).version !== version) continue;
      const names = new Set(
        api(`repos/${REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`)
          .artifacts.filter((artifact) => !artifact.expired)
          .map((artifact) => artifact.name),
      );
      if (COMPILED_ARTIFACTS.every((name) => names.has(name))) return String(run.id);
    } catch (error) {
      console.log(`Run ${run.id} not reusable: ${error.message}`);
    }
  }
  return "";
}

function main() {
  const canary = process.env.GITHUB_REF_NAME === "canary";
  const sha = git("rev-parse", process.argv[2] ?? "HEAD");
  const stable = releases();
  const canaries = canary ? releases("canary") : [];
  const state = plan(canary, sha, stable, canaries);
  if (canary && state.mode === "publish" && state.previous_tag)
    assertStableMerged(state.previous_tag, sha);
  state.reuse_run_id =
    state.mode === "publish" && process.env.RELEASE_REBUILD !== "true"
      ? reusableRun(canary, sha, stable, canaries, state.version)
      : "";
  outputs(state);
  console.log(
    state.mode === "publish"
      ? `Release v${state.version} (previous ${state.previous_tag || "none"})`
      : `No release: ${state.mode}${state.version ? ` (v${state.version})` : ""}`,
  );
  if (state.reuse_run_id) console.log(`Reusing compiled snapshots from run ${state.reuse_run_id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
