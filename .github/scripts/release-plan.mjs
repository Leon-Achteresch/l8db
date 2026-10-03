import { pathToFileURL } from "node:url";
import {
  git,
  newestRelease,
  nextVersion,
  outputs,
  releases,
  semanticBump,
} from "./release-utils.mjs";

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

function main() {
  const all = releases();
  const sha = git("rev-parse", "HEAD");
  const previous = newestRelease(all)?.tag_name;
  if (previous) git("merge-base", "--is-ancestor", previous, sha);
  const messages = git(
    "log",
    previous ? `${previous}..${sha}` : sha,
    "--no-merges",
    "--format=%B%x00",
  )
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
  const state = releaseState(sha, all, messages);
  outputs(state);
  console.log(
    state.mode === "publish"
      ? `Release v${state.version} (previous ${state.previous_tag || "none"})`
      : `No release: ${state.mode}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
