import { describe, expect, test } from "bun:test";
import {
  diffChangeLines,
  diffOverviewLine,
  nextDiffLine,
} from "../src/features/compare/diff-navigation";

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

describe("Cursor aus der Diff-Übersicht", () => {
  test("findet die angeklickte Änderung anhand ihrer Scrollposition", () => {
    const markers = [
      { line: 10, top: 200, height: 22 },
      { line: 50, top: 1200, height: 88 },
    ];
    expect(diffOverviewLine(markers, 21, 200, 2000)).toBe(10);
    expect(diffOverviewLine(markers, 124, 200, 2000)).toBe(50);
    expect(nextDiffLine([10, 50, 90], diffOverviewLine(markers, 124, 200, 2000) ?? 1, 1, 100)).toBe(
      90,
    );
    expect(
      nextDiffLine([10, 50, 90], diffOverviewLine(markers, 124, 200, 2000) ?? 1, -1, 100),
    ).toBe(10);
  });

  test("berücksichtigt Mindesthöhe, benachbarte Markierungen und den Rand", () => {
    const markers = [
      { line: 1, top: 0, height: 22 },
      { line: 10, top: 220, height: 22 },
      { line: 11, top: 242, height: 22 },
      { line: 100, top: 1978, height: 22 },
    ];
    expect(diffOverviewLine(markers, 0, 200, 2000)).toBe(1);
    expect(diffOverviewLine(markers, 22, 200, 2000)).toBe(10);
    expect(diffOverviewLine(markers, 25, 200, 2000)).toBe(11);
    expect(diffOverviewLine(markers, 200, 200, 2000)).toBe(100);
  });

  test("lässt Klicks auf unveränderte Bereiche und leere Übersichten unverändert", () => {
    expect(diffOverviewLine([{ line: 20, top: 400, height: 22 }], 100, 200, 2000)).toBeNull();
    expect(diffOverviewLine([], 100, 200, 2000)).toBeNull();
    expect(diffOverviewLine([{ line: 1, top: 0, height: 22 }], 0, 0, 2000)).toBeNull();
    expect(diffOverviewLine([{ line: 1, top: 0, height: 22 }], 0, 200, 0)).toBeNull();
  });
});
