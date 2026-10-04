import { pathToFileURL } from "node:url";
import {
  api,
  buildEquivalent,
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

function commitMessages(previous, sha) {
  if (previous) git("merge-base", "--is-ancestor", previous, sha);
  return git("log", previous ? `${previous}..${sha}` : sha, "--no-merges", "--format=%B%x00")
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
}

function reusableRun(sha, all, previous, version) {
  const runs = api(
    `repos/${REPOSITORY}/actions/workflows/release.yml/runs?branch=main&status=completed&per_page=20`,
  ).workflow_runs;
  for (const run of runs) {
    try {
      if (all.some((release) => !release.draft && release.target_commitish === run.head_sha))
        continue;
      if (!buildEquivalent(run.head_sha, sha)) continue;
      if (
        releaseState(run.head_sha, all, commitMessages(previous, run.head_sha)).version !== version
      )
        continue;
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
  const all = releases();
  const sha = git("rev-parse", "HEAD");
  const previous = newestRelease(all)?.tag_name;
  const state = releaseState(sha, all, commitMessages(previous, sha));
  state.reuse_run_id =
    state.mode === "publish" && process.env.RELEASE_REBUILD !== "true"
      ? reusableRun(sha, all, previous, state.version)
      : "";
  outputs(state);
  console.log(
    state.mode === "publish"
      ? `Release v${state.version} (previous ${state.previous_tag || "none"})`
      : `No release: ${state.mode}`,
  );
  if (state.reuse_run_id) console.log(`Reusing compiled snapshots from run ${state.reuse_run_id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
