import { afterEach, expect, test } from "bun:test";
import { nightlyCandidate, promoteNightly } from "../.github/scripts/nightly-release.mjs";
import { REPOSITORY } from "../.github/scripts/release-utils.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const pull = {
  number: 42,
  state: "open",
  draft: false,
  base: { ref: "main" },
  head: { ref: "canary", sha, repo: { full_name: REPOSITORY } },
};
const canary = {
  draft: false,
  prerelease: true,
  tag_name: "v1.2.3-canary.1",
  target_commitish: sha,
};
const ref = process.env.GITHUB_REF;
afterEach(() => {
  if (ref === undefined) delete process.env.GITHUB_REF;
  else process.env.GITHUB_REF = ref;
});

test("only an explicitly approved, published Canary with an internal release PR qualifies", () => {
  expect(nightlyCandidate(sha, sha, [pull], [canary])).toBe(pull);
  expect(nightlyCandidate("", sha, [pull], [canary])).toBeNull();
  expect(() => nightlyCandidate("main", sha, [pull], [canary])).toThrow("full commit SHA");
  expect(() => nightlyCandidate(sha, other, [pull], [canary])).toThrow("changed after approval");
  for (const invalid of [
    { ...pull, draft: true },
    { ...pull, state: "closed" },
    { ...pull, base: { ref: "development" } },
    { ...pull, head: { ...pull.head, sha: other } },
    { ...pull, head: { ...pull.head, repo: { full_name: "fork/l8db" } } },
  ]) {
    expect(() => nightlyCandidate(sha, sha, [invalid], [canary])).toThrow("No open");
  }
  for (const invalid of [
    { ...canary, draft: true },
    { ...canary, prerelease: false },
    { ...canary, target_commitish: other },
    { ...canary, tag_name: "v1.2.3" },
  ]) {
    expect(() => nightlyCandidate(sha, sha, [pull], [invalid])).toThrow("not been published");
  }
});

function fixture() {
  const requests: string[] = [];
  const writes: string[][] = [];
  let approved = sha;
  let head = sha;
  return {
    requests,
    writes,
    revoke: () => {
      approved = other;
    },
    advance: () => {
      head = other;
    },
    options: {
      approval: sha,
      request: (route: string) => {
        requests.push(route);
        if (route.includes("/git/ref/")) return { object: { sha: head } };
        if (route.includes("/pulls?")) return [pull];
        if (route.endsWith("/NIGHTLY_RELEASE_SHA")) return { value: approved };
        throw new Error(`Unexpected request: ${route}`);
      },
      published: () => [canary],
      run: (...args: string[]) => {
        writes.push(args);
        return "";
      },
    },
  };
}

test("idle approvals make zero requests and dry runs never write", () => {
  const value = fixture();
  expect(promoteNightly({ ...value.options, approval: "" })).toBeNull();
  expect(value.requests).toHaveLength(0);
  expect(promoteNightly(value.options)).toBe(pull);
  expect(value.requests).toHaveLength(2);
  expect(value.writes).toHaveLength(0);
});

test("promotion rechecks revocation and uses an atomic head SHA guard without admin bypass", () => {
  process.env.GITHUB_REF = "refs/heads/main";
  const value = fixture();
  promoteNightly({ ...value.options, dryRun: false });
  expect(value.requests).toHaveLength(5);
  expect(value.writes).toEqual([
    ["pr", "merge", "42", "--repo", REPOSITORY, "--merge", "--match-head-commit", sha],
  ]);
  const revoked = fixture();
  revoked.revoke();
  expect(() => promoteNightly({ ...revoked.options, dryRun: false })).toThrow("revoked");
  expect(revoked.writes).toHaveLength(0);
  process.env.GITHUB_REF = "refs/heads/development";
  expect(() => promoteNightly({ ...value.options, dryRun: false })).toThrow("only from main");
  expect(value.writes).toHaveLength(1);
});

test("a Canary moving during validation cannot be merged", () => {
  process.env.GITHUB_REF = "refs/heads/main";
  const value = fixture();
  let calls = 0;
  expect(() =>
    promoteNightly({
      ...value.options,
      dryRun: false,
      request: (route: string) => {
        if (++calls === 4) value.advance();
        return value.options.request(route);
      },
    }),
  ).toThrow("changed after approval");
  expect(value.writes).toHaveLength(0);
});

test("release selection stays bounded with 100 PRs and 1,000 published Canaries", () => {
  const pulls = Array.from({ length: 99 }, () => ({ ...pull, draft: true })).concat(pull);
  const published = Array.from({ length: 999 }, () => ({
    ...canary,
    target_commitish: other,
  })).concat(canary);
  const timings: number[] = [];
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  for (let index = 0; index < 500; index++) {
    const start = performance.now();
    expect(nightlyCandidate(sha, sha, pulls, published)).toBe(pull);
    timings.push(performance.now() - start);
  }
  Bun.gc(true);
  const retained = Math.max(0, process.memoryUsage().heapUsed - before);
  timings.sort((a, b) => a - b);
  const median = timings[250];
  const p95 = timings[475];
  expect(p95).toBeLessThan(5);
  expect(retained).toBeLessThan(4 * 1024 * 1024);
  console.log(
    JSON.stringify({
      workload: "500 selections; 100 PRs; 1000 Canaries",
      medianMs: median,
      p95Ms: p95,
      retainedBytes: retained,
    }),
  );
});
