import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

test("release body starts with the next version and lists commits", () => {
  const body = execFileSync(
    "node",
    [".github/scripts/generate-changelog.mjs", "--next", "9.9.9", "--release-body"],
    { encoding: "utf8" },
  );
  expect(body).toMatch(/^## \[9\.9\.9\] - \d{4}-\d{2}-\d{2}\n/);
  expect(body).toMatch(/\n- /);
});
