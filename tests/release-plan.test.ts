import { describe, expect, test } from "bun:test";
import { releaseBody, releaseNotes } from "../.github/scripts/release.mjs";
import { canaryState, previousCanary, releaseState } from "../.github/scripts/release-plan.mjs";
import {
  buildNeutral,
  compareReleases,
  compareVersions,
  nextVersion,
  semanticBump,
} from "../.github/scripts/release-utils.mjs";

const sha = "a".repeat(40);
const published = {
  id: 1,
  tag_name: "v0.8.24",
  target_commitish: sha,
  draft: false,
  prerelease: false,
  immutable: true,
};
describe("release version planning and retries", () => {
  test("migrates commit-count releases to monotonically increasing SemVer", () => {
    expect(nextVersion("0.8.0", "0.8.24")).toBe("0.8.25");
    expect(nextVersion("0.8.24", "0.8.24")).toBe("0.8.25");
    expect(nextVersion("0.9.0", "0.8.24")).toBe("0.9.0");
    expect(nextVersion("0.8.0", "0.8.24", "minor")).toBe("0.9.0");
    expect(nextVersion("0.8.0", "0.8.24", "major")).toBe("1.0.0");
    expect(compareVersions("0.8.100", "0.8.99")).toBe(1);
    expect(() => nextVersion("0.8.0-beta", "0.8.24")).toThrow();
  });
  test("derives the SemVer bump from conventional commits", () => {
    expect(semanticBump(["fix: a", "chore: b", "docs: c"], "0.8.24")).toBe("patch");
    expect(semanticBump(["perf: a"], "0.8.24")).toBe("patch");
    expect(semanticBump(["fix: a", "feat(grid): b"], "0.8.24")).toBe("minor");
    expect(semanticBump(["feat!: a"], "1.2.3")).toBe("major");
    expect(semanticBump(["fix: a\n\nBREAKING CHANGE: removed x"], "1.2.3")).toBe("major");
    expect(semanticBump(["refactor(db)!: a"], "0.8.24")).toBe("minor");
  });
  test("skips a release without releasable commits", () => {
    expect(semanticBump(["chore: a", "docs: b", "ci: c", "Merge branch 'x'"], "0.8.24")).toBeNull();
    expect(releaseState("b".repeat(40), [published], ["docs: only"])).toMatchObject({
      mode: "skip",
    });
  });
  test("skips builds and mutation for an already published source commit", () => {
    expect(releaseState(sha, [published], ["feat: a"])).toMatchObject({
      mode: "complete",
      version: "0.8.24",
    });
  });
  test("computes the next version from the latest published release", () => {
    const draft = { ...published, id: 2, draft: true, tag_name: "v0.9.0", target_commitish: "c" };
    expect(releaseState("b".repeat(40), [published, draft], ["fix: a", "feat: b"])).toEqual({
      mode: "publish",
      version: "0.9.0",
      previous_tag: "v0.8.24",
    });
    expect(releaseState("b".repeat(40), [], ["fix: a"])).toMatchObject({ version: "0.0.1" });
  });
  test("reads exactly the notes for the candidate", () => {
    const changelog =
      "# Changelog\n\n## [0.8.25] - 2026-10-02\n\n### Features\n- Current\n\n## [0.8.24] - 2026-10-01\n- Old\n";
    expect(releaseNotes("0.8.25", changelog)).toContain("Current");
    expect(releaseNotes("0.8.25", changelog)).not.toContain("Old");
    expect(() => releaseNotes("0.8.26", changelog)).toThrow("Missing release notes");
    const canary =
      "## [0.9.0-canary.2] - 2026-10-03\n- Canary\n\n## [0.8.24] - 2026-10-01\n- Old\n";
    expect(releaseNotes("0.9.0-canary.2", canary)).toContain("Canary");
    expect(releaseNotes("0.9.0-canary.2", canary)).not.toContain("Old");
  });
  test("marks canary release pages and names the current stable version", () => {
    expect(releaseBody("0.9.0", "## [0.9.0]", "v0.8.24")).toBe("## [0.9.0]");
    const body = releaseBody("0.9.0-canary.2", "## [0.9.0-canary.2]", "v0.8.24");
    expect(body.startsWith("> [!WARNING]\n> Canary pre-release")).toBe(true);
    expect(body).toContain(
      "[v0.8.24](https://github.com/Leon-Achteresch/l8db/releases/tag/v0.8.24)",
    );
    expect(body.endsWith("\n\n## [0.9.0-canary.2]")).toBe(true);
    expect(releaseBody("0.9.0-canary.2", "notes", undefined)).not.toContain("stable version");
  });
});

function canary(tag: string, target = "c".repeat(40), draft = false) {
  return {
    id: 3,
    tag_name: tag,
    target_commitish: target,
    draft,
    prerelease: true,
    immutable: !draft,
  };
}

describe("canary version planning", () => {
  const candidate = "b".repeat(40);
  test("orders canaries below their release and by counter", () => {
    expect(compareReleases("0.9.0-canary.2", "0.9.0")).toBe(-1);
    expect(compareReleases("0.9.0-canary.10", "0.9.0-canary.9")).toBe(1);
    expect(compareReleases("0.9.0-canary.1", "0.8.24")).toBe(1);
    expect(compareReleases("0.9.0", "0.9.0")).toBe(0);
    expect(() => compareReleases("0.9.0-beta.1", "0.9.0")).toThrow();
  });
  test("counts canaries per target and restarts when the target moves", () => {
    const canaries = [
      canary("v0.9.0-canary.1"),
      canary("v0.9.0-canary.2"),
      canary("v0.9.0-canary.3", "d".repeat(40), true),
    ];
    expect(
      canaryState(candidate, [published], canaries, ["feat: a", "fix: b"], ["fix: b"]),
    ).toEqual({
      mode: "publish",
      version: "0.9.0-canary.3",
      previous_tag: "v0.8.24",
    });
    expect(
      canaryState(
        candidate,
        [published],
        [canary("v0.8.25-canary.4")],
        ["fix: a", "feat: b"],
        ["feat: b"],
      ),
    ).toMatchObject({ version: "0.9.0-canary.1" });
    expect(canaryState(candidate, [], [], ["fix: a"], ["fix: a"])).toMatchObject({
      version: "0.0.1-canary.1",
    });
  });
  test("skips without releasable commits since the last canary or release", () => {
    const canaries = [canary("v0.9.0-canary.1")];
    expect(canaryState(candidate, [published], canaries, ["feat: a"], ["docs: b"])).toMatchObject({
      mode: "skip",
      previous_tag: "v0.8.24",
    });
    expect(canaryState(candidate, [published], [], ["chore: a"], ["chore: a"])).toMatchObject({
      mode: "skip",
    });
  });
  test("skips builds for an already published canary commit", () => {
    expect(
      canaryState(candidate, [published], [canary("v0.9.0-canary.1", candidate)], ["feat: a"], []),
    ).toMatchObject({ mode: "complete", version: "0.9.0-canary.1" });
  });
  test("measures new commits from the newest canary above the stable release", () => {
    const canaries = [
      canary("v0.8.24-canary.5"),
      canary("v0.8.25-canary.1"),
      canary("v0.9.0-canary.2"),
      canary("v0.9.0-canary.3", "d".repeat(40), true),
    ];
    expect(previousCanary([published], canaries)?.tag_name).toBe("v0.9.0-canary.2");
    expect(previousCanary([published], [canary("v0.8.24-canary.5")])).toBeUndefined();
  });
});

test("reuses compiled snapshots only when no build input changed", () => {
  expect(buildNeutral([".github/scripts/release-smoke.mjs", "tests/a.test.ts", "docs/x.md"])).toBe(
    true,
  );
  expect(buildNeutral([".github/scripts/release.mjs", ".github/RELEASING.md"])).toBe(true);
  expect(buildNeutral([".github/scripts/set-version.mjs"])).toBe(false);
  expect(buildNeutral([".github/scripts/build-snapshot.mjs"])).toBe(false);
  expect(buildNeutral([".github/workflows/release.yml"])).toBe(false);
  expect(buildNeutral([".github/actions/setup-rust/action.yml"])).toBe(false);
  expect(buildNeutral(["src/main.tsx"])).toBe(false);
  expect(buildNeutral(["src-tauri/Cargo.toml"])).toBe(false);
});
