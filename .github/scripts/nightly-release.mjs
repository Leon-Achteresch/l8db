import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { api, CANARY_PATTERN, gh, REPOSITORY, releases } from "./release-utils.mjs";

export function nightlyCandidate(approval, head, pulls, published) {
  if (!approval) return null;
  assert(/^[a-f0-9]{40}$/.test(approval), "Approval must be a full commit SHA");
  assert.equal(head, approval, "Canary changed after approval; approve the new SHA explicitly");
  const pull = pulls.find(
    (item) =>
      item.state === "open" &&
      !item.draft &&
      item.base.ref === "main" &&
      item.head.ref === "canary" &&
      item.head.repo?.full_name === REPOSITORY &&
      item.head.sha === approval,
  );
  assert(pull, "No open canary → main PR for the approved SHA");
  assert(
    published.some(
      (item) =>
        !item.draft &&
        item.prerelease &&
        CANARY_PATTERN.test(item.tag_name.slice(1)) &&
        item.target_commitish === approval,
    ),
    "Approved SHA has not been published as a Canary",
  );
  return pull;
}

export function promoteNightly({
  approval,
  dryRun = true,
  request = api,
  published = releases,
  run = gh,
}) {
  if (!approval) {
    console.log("No NIGHTLY_RELEASE_SHA approval; no merge or release.");
    return null;
  }
  const root = `repos/${REPOSITORY}`;
  const load = () =>
    nightlyCandidate(
      approval,
      request(`${root}/git/ref/heads/canary`).object.sha,
      request(`${root}/pulls?state=open&base=main&head=Leon-Achteresch:canary&per_page=100`),
      published("canary"),
    );
  const pull = load();
  console.log(`${dryRun ? "Dry run" : "Nightly release"}: PR #${pull.number}, Canary ${approval}`);
  if (dryRun) return pull;
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Nightly merges run only from main");
  assert.equal(
    request(`${root}/actions/variables/NIGHTLY_RELEASE_SHA`).value,
    approval,
    "Approval was revoked or changed",
  );
  const current = load();
  assert.equal(current.number, pull.number, "Release PR changed during validation");
  run(
    "pr",
    "merge",
    String(pull.number),
    "--repo",
    REPOSITORY,
    "--merge",
    "--match-head-commit",
    approval,
  );
  return pull;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  promoteNightly({
    approval: process.env.NIGHTLY_RELEASE_SHA ?? "",
    dryRun: process.env.NIGHTLY_RELEASE_DRY_RUN !== "false",
  });
}
