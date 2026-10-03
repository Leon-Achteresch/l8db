import { expect, test } from "bun:test";
import { parseAiDiff } from "../src/lib/ai/diff";

test("unified diffs exclude file headers from counts and strip each change marker once", () => {
  const lines = parseAiDiff(
    "diff --git a/query.sql b/query.sql\nindex abc..def 100644\n--- a/query.sql\n+++ b/query.sql\n@@ -10,3 +20,3 @@\n SELECT\n-old_value\n+new_value\n FROM users\n",
    "diff",
  );
  expect(lines.filter((line) => line.type === "added")).toEqual([
    { id: "diff-7", type: "added", newLine: 21, content: "new_value" },
  ]);
  expect(lines.filter((line) => line.type === "removed")).toEqual([
    { id: "diff-6", type: "removed", oldLine: 11, content: "old_value" },
  ]);
  expect(
    lines.filter((line) => line.oldLine !== undefined && line.newLine !== undefined),
  ).toMatchObject([
    { oldLine: 10, newLine: 20, content: "SELECT" },
    { oldLine: 12, newLine: 22, content: "FROM users" },
  ]);
  expect(lines[0]).toMatchObject({ type: "context", content: "@@ -10,3 +20,3 @@" });
  expect(lines[0].oldLine).toBeUndefined();
});

test("diff hunks restart line counters and preserve original plus/minus content", () => {
  const lines = parseAiDiff(
    "--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- original\n+++ replacement\n\\ No newline at end of file\n@@ -40,0 +41,1 @@\n+last",
    "multi",
  );
  expect(lines.filter((line) => line.type === "removed")[0]).toMatchObject({
    content: "-- original",
    oldLine: 1,
  });
  expect(lines.filter((line) => line.type === "added")).toMatchObject([
    { content: "++ replacement", newLine: 1 },
    { content: "last", newLine: 41 },
  ]);
  const marker = lines.find((line) => line.content.startsWith("\\"));
  expect(marker?.type).toBe("context");
  expect(marker?.oldLine).toBeUndefined();
  expect(marker?.newLine).toBeUndefined();
});

test("ACP before/after diffs omit headings and number content from the first line", () => {
  const lines = parseAiDiff("--- Vorher\n-SELECT 1\n+++ Nachher\n+SELECT 2", "acp");
  expect(lines).toEqual([
    { id: "acp-1", type: "removed", oldLine: 1, content: "SELECT 1" },
    { id: "acp-3", type: "added", newLine: 1, content: "SELECT 2" },
  ]);
});
