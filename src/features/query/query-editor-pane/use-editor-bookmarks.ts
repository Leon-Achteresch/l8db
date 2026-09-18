import { type RefObject, useRef } from "react";

import { monaco } from "@/lib/monaco";
import type { BookmarkSlots } from "@/lib/table-tabs";

interface UseEditorBookmarksOptions {
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  bookmarks?: number[];
  bookmarkSlots?: BookmarkSlots;
  onBookmarksChange?: (lines: number[]) => void;
  onBookmarkSlotChange?: (slot: number, line: number | null) => void;
}

export function useEditorBookmarks({
  editorRef,
  bookmarks,
  bookmarkSlots,
  onBookmarksChange,
  onBookmarkSlotChange,
}: UseEditorBookmarksOptions) {
  const bookmarkDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const bookmarksRef = useRef<number[]>(bookmarks ?? []);
  const slotDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection[]>([]);
  const slotsRef = useRef<BookmarkSlots>(bookmarkSlots ?? {});
  const suppressPublishRef = useRef(false);
  const onBookmarksChangeRef = useRef(onBookmarksChange);
  const onBookmarkSlotChangeRef = useRef(onBookmarkSlotChange);
  onBookmarksChangeRef.current = onBookmarksChange;
  onBookmarkSlotChangeRef.current = onBookmarkSlotChange;

  const readBookmarkLines = (): number[] => {
    const collection = bookmarkDecorationsRef.current;
    if (!collection) return [];
    const lines = new Set<number>();
    for (const range of collection.getRanges()) lines.add(range.startLineNumber);
    return [...lines].sort((a, b) => a - b);
  };

  const applyBookmarks = (lines: number[]) => {
    const collection = bookmarkDecorationsRef.current;
    const model = editorRef.current?.getModel();
    if (!collection || !model) return;
    const maxLine = model.getLineCount();
    const valid = [...new Set(lines.filter((line) => line >= 1 && line <= maxLine))].sort(
      (a, b) => a - b,
    );
    collection.set(
      valid.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          glyphMarginClassName: "l8db-bookmark-glyph",
          glyphMarginHoverMessage: { value: "Lesezeichen" },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  };

  const publishBookmarks = () => {
    if (suppressPublishRef.current) return;
    const lines = readBookmarkLines();
    const previous = bookmarksRef.current;
    if (lines.length === previous.length && lines.every((line, i) => line === previous[i])) return;
    bookmarksRef.current = lines;
    onBookmarksChangeRef.current?.(lines);
  };

  const toggleBookmarkAtCursor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const line = editor.getPosition()?.lineNumber;
    if (!line) return;
    const current = readBookmarkLines();
    const next = current.includes(line)
      ? current.filter((entry) => entry !== line)
      : [...current, line].sort((a, b) => a - b);
    applyBookmarks(next);
    publishBookmarks();
  };

  const gotoBookmarkLine = (direction: "next" | "previous") => {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = readBookmarkLines();
    if (lines.length === 0) return;
    const current = editor.getPosition()?.lineNumber ?? 1;
    const target =
      direction === "next"
        ? (lines.find((line) => line > current) ?? lines[0])
        : ([...lines].reverse().find((line) => line < current) ?? lines[lines.length - 1]);
    editor.setPosition({ lineNumber: target, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(target);
    editor.focus();
  };

  const readSlotLine = (slot: number): number | null => {
    const collection = slotDecorationsRef.current[slot - 1];
    if (!collection) return slotsRef.current[String(slot)] ?? null;
    const ranges = collection.getRanges();
    return ranges.length > 0 ? ranges[0].startLineNumber : null;
  };

  const applySlots = (slots: BookmarkSlots) => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const maxLine = model.getLineCount();
    slotDecorationsRef.current.forEach((collection, index) => {
      const line = slots[String(index + 1)];
      collection.set(
        line !== undefined && line >= 1 && line <= maxLine
          ? [
              {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  glyphMarginClassName: `l8db-bookmark-glyph l8db-bookmark-slot-${index + 1}`,
                  glyphMarginHoverMessage: { value: `Lesezeichen ${index + 1}` },
                  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
              },
            ]
          : [],
      );
    });
  };

  const publishSlots = () => {
    if (suppressPublishRef.current) return;
    const changed: Array<[number, number | null]> = [];
    for (let slot = 1; slot <= 9; slot += 1) {
      const line = readSlotLine(slot);
      if (line !== (slotsRef.current[String(slot)] ?? null)) changed.push([slot, line]);
    }
    if (changed.length === 0) return;
    const next: BookmarkSlots = { ...slotsRef.current };
    for (const [slot, line] of changed) {
      if (line === null) delete next[String(slot)];
      else next[String(slot)] = line;
    }
    slotsRef.current = next;
    for (const [slot, line] of changed) onBookmarkSlotChangeRef.current?.(slot, line);
  };

  const setSlotAtCursor = (slot: number) => {
    const editor = editorRef.current;
    const collection = slotDecorationsRef.current[slot - 1];
    if (!editor || !collection) return;
    const line = editor.getPosition()?.lineNumber;
    if (!line) return;
    const current = readSlotLine(slot);
    const target = current === line ? null : line;
    collection.set(
      target === null
        ? []
        : [
            {
              range: new monaco.Range(target, 1, target, 1),
              options: {
                isWholeLine: true,
                glyphMarginClassName: `l8db-bookmark-glyph l8db-bookmark-slot-${slot}`,
                glyphMarginHoverMessage: { value: `Lesezeichen ${slot}` },
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            },
          ],
    );
    publishSlots();
  };

  const gotoSlotLine = (slot: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const line = readSlotLine(slot);
    if (!line) return;
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.focus();
  };

  return {
    bookmarkDecorationsRef,
    bookmarksRef,
    slotDecorationsRef,
    slotsRef,
    suppressPublishRef,
    readBookmarkLines,
    applyBookmarks,
    publishBookmarks,
    toggleBookmarkAtCursor,
    gotoBookmarkLine,
    readSlotLine,
    applySlots,
    publishSlots,
    setSlotAtCursor,
    gotoSlotLine,
  };
}
