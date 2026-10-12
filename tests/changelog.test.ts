import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("release body starts with the next version and lists commits", () => {
  const body = execFileSync(
    "node",
    [".github/scripts/generate-changelog.mjs", "--next", "9.9.9", "--release-body"],
    { encoding: "utf8" },
  );
  expect(body).toMatch(/^## \[9\.9\.9\] - \d{4}-\d{2}-\d{2}\n/);
  expect(body).toMatch(/\n- /);
});

test("canary notes start at the previous canary and see stable tags on main", () => {
  const root = mkdtempSync(join(tmpdir(), "l8db-changelog-"));
  const script = resolve(".github/scripts/generate-changelog.mjs");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const commit = (message: string, tag?: string) => {
    git("commit", "--allow-empty", "-q", "-m", message);
    if (tag) git("tag", tag);
  };
  const changelog = (version: string) => {
    execFileSync("node", [script, "--next", version, "--date", "2026-10-08"], { cwd: root });
    return readFileSync(join(root, "CHANGELOG.md"), "utf8");
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    commit("feat: base", "v0.1.0");
    git("checkout", "-q", "-b", "canary");
    commit("feat: first", "v0.2.0-canary.1");
    commit("fix: second", "v0.2.0-canary.2");
    commit("feat: third");
    const canary = changelog("0.2.0-canary.3");
    expect(canary).toContain(
      "## [0.2.0-canary.3] - 2026-10-08\n\n### Features\n- third\n\n## [0.2.0-canary.2]",
    );
    expect(canary).toContain("## [0.2.0-canary.1]");
    expect(canary).toContain("## [0.1.0]");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "canary", "-m", "Merge canary");
    git("tag", "v0.2.0");
    const stable = changelog("0.2.0");
    expect(stable).toContain(
      "## [0.2.0] - 2026-10-08\n\n### Features\n- third\n- first\n\n### Fixes\n- second\n\n## [0.1.0]",
    );
    expect(stable).not.toContain("canary");
    git("checkout", "-q", "canary");
    commit("fix: fourth");
    expect(changelog("0.2.1-canary.1")).toContain(
      "## [0.2.1-canary.1] - 2026-10-08\n\n### Fixes\n- fourth\n\n## [0.2.0]",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
