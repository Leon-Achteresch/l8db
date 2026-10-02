import { describe, expect, test } from "bun:test";
import { releaseNotes } from "../.github/scripts/release.mjs";
import { releaseState } from "../.github/scripts/release-plan.mjs";
import { compareVersions, nextVersion, semanticBump } from "../.github/scripts/release-utils.mjs";

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
    expect(semanticBump(["fix: a", "feat(grid): b"], "0.8.24")).toBe("minor");
    expect(semanticBump(["feat!: a"], "1.2.3")).toBe("major");
    expect(semanticBump(["fix: a\n\nBREAKING CHANGE: removed x"], "1.2.3")).toBe("major");
    expect(semanticBump(["refactor(db)!: a"], "0.8.24")).toBe("minor");
    expect(semanticBump(["Merge branch 'x'", "feature without prefix"], "0.8.24")).toBe("patch");
  });
  test("skips builds and mutation for an already published source commit", () => {
    expect(releaseState("0.8.24", sha, [published], true).mode).toBe("complete");
  });
  test("requires a prepared release plan and refuses stale versions", () => {
    expect(releaseState("0.8.25", sha, [published], false).mode).toBe("prepare");
    expect(releaseState("0.8.0", sha, [published], true).mode).toBe("prepare");
    expect(releaseState("0.8.24", "b".repeat(40), [published], true).mode).toBe("prepare");
    expect(releaseState("0.8.25", sha, [published], true)).toMatchObject({
      mode: "publish",
      previous_tag: "v0.8.24",
    });
  });
  test("resumes the same draft but never replaces a draft from another commit", () => {
    const draft = { ...published, id: 2, draft: true, immutable: false, tag_name: "v0.8.25" };
    expect(releaseState("0.8.25", sha, [published, draft], true).release_id).toBe(2);
    expect(releaseState("0.8.25", "b".repeat(40), [published, draft], true)).toMatchObject({
      mode: "prepare",
      reason: "reserved-by-another-commit",
    });
  });
  test("reads exactly the checked-in notes for the candidate", () => {
    const changelog =
      "# Changelog\n\n## [0.8.25] - 2026-10-02\n\n### Features\n- Current\n\n## [0.8.24] - 2026-10-01\n- Old\n";
    expect(releaseNotes("0.8.25", changelog)).toContain("Current");
    expect(releaseNotes("0.8.25", changelog)).not.toContain("Old");
    expect(() => releaseNotes("0.8.26", changelog)).toThrow("Missing checked-in release notes");
  });
});
