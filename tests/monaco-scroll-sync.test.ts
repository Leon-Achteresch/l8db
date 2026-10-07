import { describe, expect, test } from "bun:test";
import { definitionHunks } from "../src/lib/definition-merge";
import type { monaco } from "../src/lib/monaco";
import {
  interpolateScrollTop,
  projectScrollLine,
  type ScrollLineMapping,
} from "../src/lib/monaco/scroll-mapping";
import {
  createScrollSyncGroup,
  joinScrollSyncGroup,
  syncScrollGroup,
} from "../src/lib/monaco/scroll-sync";

type ScrollEvent = Pick<monaco.IScrollEvent, "scrollTopChanged" | "scrollLeftChanged">;

class ScrollEditor {
  readonly api = this as unknown as monaco.editor.ICodeEditor;
  readonly positions: { scrollTop?: number; scrollLeft?: number }[] = [];
  readonly scrollListeners = new Set<(event: ScrollEvent) => void>();
  readonly zoneListeners = new Set<() => void>();
  readonly focusListeners = new Set<() => void>();
  scrollTop = 0;
  scrollLeft = 0;

  constructor(
    readonly lineCount: number,
    readonly gaps: Record<number, number> = {},
  ) {}

  getModel() {
    return { getLineCount: () => this.lineCount };
  }

  getScrollTop() {
    return this.scrollTop;
  }

  getScrollLeft() {
    return this.scrollLeft;
  }

  getTopForLineNumber(line: number) {
    const position = Math.min(Math.max(line, 1), this.lineCount);
    return (
      12 +
      (position - 1) * 22 +
      Object.entries(this.gaps).reduce(
        (height, [after, gap]) => height + (Number(after) < position ? gap : 0),
        0,
      )
    );
  }

  getBottomForLineNumber(line: number) {
    return this.getTopForLineNumber(line) + 22;
  }

  getVisibleRanges() {
    let line = 1;
    while (line < this.lineCount && this.getTopForLineNumber(line) < this.scrollTop) line++;
    return [{ startLineNumber: line }];
  }

  setScrollPosition(position: { scrollTop?: number; scrollLeft?: number }) {
    this.positions.push(position);
    this.scrollTo(position.scrollTop ?? this.scrollTop, position.scrollLeft ?? this.scrollLeft);
  }

  scrollTo(top: number, left = this.scrollLeft) {
    const event = {
      scrollTopChanged: this.scrollTop !== top,
      scrollLeftChanged: this.scrollLeft !== left,
    };
    this.scrollTop = top;
    this.scrollLeft = left;
    for (const listener of this.scrollListeners) listener(event);
  }

  onDidScrollChange(listener: (event: ScrollEvent) => void) {
    this.scrollListeners.add(listener);
    return { dispose: () => this.scrollListeners.delete(listener) };
  }

  onDidChangeViewZones(listener: () => void) {
    this.zoneListeners.add(listener);
    return { dispose: () => this.zoneListeners.delete(listener) };
  }

  onDidFocusEditorWidget(listener: () => void) {
    this.focusListeners.add(listener);
    return { dispose: () => this.focusListeners.delete(listener) };
  }
}

function mappings(source: string, result: string): ScrollLineMapping[] {
  return definitionHunks(source, result).map((hunk) => ({
    sourceStart: hunk.sourceStart,
    sourceEnd: hunk.sourceEnd,
    targetStart: hunk.draftStart,
    targetEnd: hunk.draftEnd,
  }));
}

describe("Merge-Ergebnis: Zuordnung der Textstellen", () => {
  const edits = mappings("a\nb\nc\nd\ne", "a\nnew 1\nnew 2\nb\ne");

  test("ordnet unveränderte Zeilen nach Einfügungen und Löschungen in beide Richtungen zu", () => {
    expect(projectScrollLine(edits, 2).targetStart).toBe(4);
    expect(projectScrollLine(edits, 5).targetStart).toBe(5);
    expect(projectScrollLine(edits, 4, true).targetStart).toBe(2);
    expect(projectScrollLine(edits, 5, true).targetStart).toBe(5);
  });

  test("ordnet geänderte Bereiche und leere Gegenstücke zu", () => {
    expect(projectScrollLine(edits, 3)).toEqual({
      sourceStart: 3,
      sourceEnd: 5,
      targetStart: 5,
      targetEnd: 5,
    });
    expect(projectScrollLine(edits, 2, true)).toEqual({
      sourceStart: 2,
      sourceEnd: 4,
      targetStart: 2,
      targetEnd: 2,
    });
    expect(projectScrollLine([], 7).targetStart).toBe(7);
  });

  test("interpoliert in unterschiedlich langen Blöcken und hält leere Bereiche stabil", () => {
    expect(interpolateScrollTop(150, 100, 200, 200, 400)).toBe(300);
    expect(interpolateScrollTop(150, 100, 200, 300, 300)).toBe(300);
    expect(interpolateScrollTop(50, 100, 100, 300, 500)).toBe(300);
    expect(interpolateScrollTop(0, 12, 34, 12, 34)).toBe(0);
  });
});

describe("Merge-Ergebnis: synchrones Scrollen", () => {
  test("folgt der gleichen Textstelle statt der gleichen Pixelzahl und verhindert Rückkopplung", () => {
    const group = createScrollSyncGroup();
    group.enabled = true;
    group.mappings = mappings("a\nb\nc\nd\ne", "a\nnew 1\nnew 2\nb\nc\nd\ne");
    const source = new ScrollEditor(5, { 1: 44 });
    const result = new ScrollEditor(7);
    joinScrollSyncGroup(group, source.api);
    joinScrollSyncGroup(group, result.api, "result");
    source.scrollTo(source.getTopForLineNumber(3) + 7);
    expect(result.scrollTop).toBe(result.getTopForLineNumber(5) + 7);
    expect(source.positions).toHaveLength(0);
    expect(result.positions).toHaveLength(1);
    result.scrollTo(result.getTopForLineNumber(6) + 9);
    expect(source.scrollTop).toBe(source.getTopForLineNumber(4) + 9);
    expect(source.positions).toHaveLength(1);
    expect(result.positions).toHaveLength(1);
  });

  test("entfernt nur optische Diff-Lücken aus der Ergebnisposition", () => {
    const group = createScrollSyncGroup();
    group.enabled = true;
    const source = new ScrollEditor(20, { 5: 220 });
    const result = new ScrollEditor(20);
    joinScrollSyncGroup(group, source.api);
    joinScrollSyncGroup(group, result.api, "result");
    source.scrollTo(source.getTopForLineNumber(10) + 11);
    expect(result.scrollTop).toBe(result.getTopForLineNumber(10) + 11);
    expect(source.scrollTop - result.scrollTop).toBe(220);
    source.scrollTo(180);
    expect(result.scrollTop).toBeCloseTo(100 + (80 / 242) * 22);
  });

  test("berechnet die Zuordnung nach Änderungen und beim Aktivieren des synchronen Scrollens neu", () => {
    const group = createScrollSyncGroup();
    const source = new ScrollEditor(20);
    const result = new ScrollEditor(23);
    const leaveSource = joinScrollSyncGroup(group, source.api);
    const leaveResult = joinScrollSyncGroup(group, result.api, "result");
    result.scrollTo(result.getTopForLineNumber(10));
    for (const focus of result.focusListeners) focus();
    expect(source.positions).toHaveLength(0);
    group.enabled = true;
    group.mappings = [{ sourceStart: 2, sourceEnd: 2, targetStart: 2, targetEnd: 5 }];
    syncScrollGroup(group);
    expect(source.scrollTop).toBe(source.getTopForLineNumber(7));
    group.mappings = [{ sourceStart: 2, sourceEnd: 2, targetStart: 2, targetEnd: 4 }];
    syncScrollGroup(group);
    expect(source.scrollTop).toBe(source.getTopForLineNumber(8));
    leaveSource();
    leaveResult();
    expect(group.editors.size).toBe(0);
    expect(group.lastScrolled).toBeNull();
    expect(
      source.scrollListeners.size + source.zoneListeners.size + source.focusListeners.size,
    ).toBe(0);
  });

  test("überträgt horizontales Scrollen ohne die vertikale Position zu verschieben", () => {
    const group = createScrollSyncGroup();
    group.enabled = true;
    const source = new ScrollEditor(20);
    const result = new ScrollEditor(20);
    joinScrollSyncGroup(group, source.api);
    joinScrollSyncGroup(group, result.api, "result");
    result.scrollTop = 200;
    source.scrollTo(0, 100);
    expect(result.scrollLeft).toBe(100);
    expect(result.scrollTop).toBe(200);
  });

  test("stellt den Schutz vor Rückkopplungen auch nach Fehlern wieder her", () => {
    const group = createScrollSyncGroup();
    group.enabled = true;
    const source = new ScrollEditor(20);
    const result = new ScrollEditor(20);
    joinScrollSyncGroup(group, source.api);
    joinScrollSyncGroup(group, result.api, "result");
    result.setScrollPosition = () => {
      throw new Error("disposed editor");
    };
    expect(() => syncScrollGroup(group)).toThrow("disposed editor");
    expect(group.syncing).toBe(false);
  });
});
