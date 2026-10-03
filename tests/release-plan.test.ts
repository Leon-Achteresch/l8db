import { describe, expect, test } from "bun:test";
import { releaseNotes } from "../.github/scripts/release.mjs";
import { releaseState } from "../.github/scripts/release-plan.mjs";
import {
  buildNeutral,
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
