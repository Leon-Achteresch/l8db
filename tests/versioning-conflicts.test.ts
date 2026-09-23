import { describe, expect, test } from "bun:test";
import {
  hasMergeMarkers,
  mergeConflicts,
  resolveMergeConflict,
} from "../src/lib/versioning/conflicts";

const conflict = (current: string, base: string, incoming: string) =>
  `<<<<<<< Aktueller Branch\n${current}||||||| Gemeinsame Basis\n${base}=======\n${incoming}>>>>>>> Quell-Branch\n`;

describe("versioning merge conflicts", () => {
  test("resolves individual conflicts without changing surrounding text", () => {
    const content = `before\n${conflict("ours\n", "old\n", "theirs\n")}middle\n${conflict("A\n", "B\n", "C\n")}after\n`;
    const first = mergeConflicts(content)[0];
    expect(first).toMatchObject({ current: "ours\n", base: "old\n", incoming: "theirs\n" });
    const partiallyResolved = resolveMergeConflict(content, first, "incoming");
    expect(partiallyResolved).toStartWith("before\ntheirs\nmiddle\n");
    expect(mergeConflicts(partiallyResolved)).toHaveLength(1);
    const fullyResolved = resolveMergeConflict(
      partiallyResolved,
      mergeConflicts(partiallyResolved)[0],
      "current",
    );
    expect(fullyResolved).toBe("before\ntheirs\nmiddle\nA\nafter\n");
    expect(hasMergeMarkers(fullyResolved)).toBe(false);
  });

  test("keeps saving blocked for incomplete markers", () => {
    expect(mergeConflicts("<<<<<<< Aktueller Branch\nunfinished")).toHaveLength(0);
    expect(hasMergeMarkers("<<<<<<< Aktueller Branch\nunfinished")).toBe(true);
    expect(hasMergeMarkers("SELECT '<<<<<<<' AS literal;\n")).toBe(false);
  });

  test("resolves Windows line endings without changing adjacent lines", () => {
    const content = `start\n${conflict("ours\n", "base\n", "theirs\n")}end\n`.replaceAll(
      "\n",
      "\r\n",
    );
    const blocks = mergeConflicts(content);
    expect(blocks).toHaveLength(1);
    expect(resolveMergeConflict(content, blocks[0], "incoming")).toBe("start\r\ntheirs\r\nend\r\n");
  });
});
