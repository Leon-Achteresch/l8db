import { expect, test } from "bun:test";
import { parseCommitPatch } from "../src/lib/versioning/commit-patch";

const sample = [
  "diff --git a/database/a.sql b/database/a.sql",
  "index 1..2 100644",
  "--- a/database/a.sql",
  "+++ b/database/a.sql",
  "@@ -1,2 +1,2 @@",
  " SELECT 1",
  "-FROM a",
  "+FROM b",
  "\\ No newline at end of file",
  "diff --git a/database/old.sql b/database/new.sql",
  "similarity index 100%",
  "rename from database/old.sql",
  "rename to database/new.sql",
  "diff --git a/database/gone.sql b/database/gone.sql",
  "deleted file mode 100644",
  "--- a/database/gone.sql",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-DROP",
  "",
].join("\n");

test("commit patch parser keeps status, counts and line numbers", () => {
  const [changed, renamed, deleted] = parseCommitPatch(sample);
  expect(changed.status).toBe("modified");
  expect([changed.added, changed.removed]).toEqual([1, 1]);
  expect(changed.lines.map((line) => [line.kind, line.old, line.new])).toEqual([
    ["hunk", undefined, undefined],
    ["ctx", 1, 1],
    ["del", 2, undefined],
    ["add", undefined, 2],
    ["note", undefined, undefined],
  ]);
  expect(renamed).toMatchObject({
    status: "renamed",
    from: "database/old.sql",
    path: "database/new.sql",
  });
  expect(deleted).toMatchObject({ status: "deleted", path: "database/gone.sql", removed: 1 });
});

test("commit patch parser handles a 200k-line commit within budget", () => {
  const files = Array.from({ length: 200 }, (_, file) =>
    [
      `diff --git a/database/f${file}.sql b/database/f${file}.sql`,
      `--- a/database/f${file}.sql`,
      `+++ b/database/f${file}.sql`,
      "@@ -1,500 +1,500 @@",
      ...Array.from({ length: 500 }, (_, line) => `-old ${line}`),
      ...Array.from({ length: 500 }, (_, line) => `+new ${line}`),
    ].join("\n"),
  );
  const patch = files.join("\n");
  const samples: number[] = [];
  for (let run = 0; run < 7; run++) {
    const start = performance.now();
    const parsed = parseCommitPatch(patch);
    samples.push(performance.now() - start);
    expect(parsed.length).toBe(200);
  }
  samples.sort((a, b) => a - b);
  const median = samples[3];
  const p95 = samples[6];
  console.log(
    `commit patch 200 files/200k lines: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(median).toBeLessThan(150);
  expect(p95).toBeLessThan(300);
});
