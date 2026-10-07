import { describe, expect, test } from "bun:test";
import { diffChangeLines, nextDiffLine } from "../src/features/compare/diff-navigation";

describe("Diff-Navigation ab der Cursorposition", () => {
  const lines = [3, 10, 20];

  test("springt zwischen Änderungen in beide Richtungen", () => {
    expect(nextDiffLine(lines, 12, 1, 30)).toBe(20);
    expect(nextDiffLine(lines, 12, -1, 30)).toBe(10);
    expect(nextDiffLine(lines, 7, 1, 30)).toBe(10);
    expect(nextDiffLine(lines, 7, -1, 30)).toBe(3);
  });

  test("setzt nach manueller Cursorbewegung an der neuen Position fort", () => {
    const first = nextDiffLine(lines, 1, 1, 30);
    expect(first).toBe(3);
    expect(nextDiffLine(lines, first ?? 1, 1, 30)).toBe(10);
    expect(nextDiffLine(lines, 19, 1, 30)).toBe(20);
    expect(nextDiffLine(lines, 8, -1, 30)).toBe(3);
  });

  test("überspringt den aktuellen Änderungsanfang und läuft am Rand um", () => {
    expect(nextDiffLine(lines, 10, 1, 30)).toBe(20);
    expect(nextDiffLine(lines, 10, -1, 30)).toBe(3);
    expect(nextDiffLine(lines, 20, 1, 30)).toBe(3);
    expect(nextDiffLine(lines, 3, -1, 30)).toBe(20);
    expect(nextDiffLine(lines, 1, -1, 30)).toBe(20);
    expect(nextDiffLine(lines, 30, 1, 30)).toBe(3);
  });

  test("behandelt leere Diffs und Änderungen hinter der letzten Zeile", () => {
    expect(nextDiffLine([], 1, 1, 1)).toBeNull();
    expect(nextDiffLine([], 1, -1, 1)).toBeNull();
    expect(nextDiffLine([31], 29, 1, 30)).toBe(30);
    expect(nextDiffLine([31], 30, -1, 30)).toBe(30);
    expect(nextDiffLine([0], 1, 1, 1)).toBe(1);
  });

  test("verwendet die Zeilen der jeweiligen Editorseite und Anker für leere Bereiche", () => {
    const changes = [
      {
        originalStartLineNumber: 2,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 5,
      },
      {
        originalStartLineNumber: 10,
        originalEndLineNumber: 12,
        modifiedStartLineNumber: 12,
        modifiedEndLineNumber: 0,
      },
      {
        originalStartLineNumber: 20,
        originalEndLineNumber: 21,
        modifiedStartLineNumber: 19,
        modifiedEndLineNumber: 20,
      },
    ];
    const original = diffChangeLines(changes, "original");
    const modified = diffChangeLines(changes, "modified");
    expect(original).toEqual([3, 10, 20]);
    expect(modified).toEqual([3, 13, 19]);
    expect(nextDiffLine(original, 12, -1, 30)).toBe(10);
    expect(nextDiffLine(modified, 12, -1, 30)).toBe(3);
    expect(nextDiffLine(modified, 12, 1, 30)).toBe(13);
  });
});
