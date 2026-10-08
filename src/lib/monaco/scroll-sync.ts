import type { monaco } from "@/lib/monaco";
import { interpolateScrollTop, projectScrollLine, type ScrollLineMapping } from "./scroll-mapping";

type ScrollSyncRole = "source" | "result";

export interface ScrollSyncGroup {
  enabled: boolean;
  syncing: boolean;
  editors: Map<monaco.editor.ICodeEditor, ScrollSyncRole>;
  mappings: readonly ScrollLineMapping[];
  lastScrolled: monaco.editor.ICodeEditor | null;
}

export function createScrollSyncGroup(): ScrollSyncGroup {
  return { enabled: false, syncing: false, editors: new Map(), mappings: [], lastScrolled: null };
}

function lineCount(editor: monaco.editor.ICodeEditor): number {
  return editor.getModel()?.getLineCount() ?? 1;
}

function lineTop(editor: monaco.editor.ICodeEditor, line: number): number {
  const count = lineCount(editor);
  return line > count ? editor.getBottomForLineNumber(count) : editor.getTopForLineNumber(line);
}

function lineEnd(editor: monaco.editor.ICodeEditor, line: number): number {
  const count = lineCount(editor);
  return line > count
    ? Math.max(editor.getContentHeight(), editor.getBottomForLineNumber(count))
    : editor.getTopForLineNumber(line);
}

function gapTop(editor: monaco.editor.ICodeEditor, line: number): number {
  return line <= 1 ? 0 : editor.getBottomForLineNumber(Math.min(line - 1, lineCount(editor)));
}

function mappedScrollTop(
  group: ScrollSyncGroup,
  source: monaco.editor.ICodeEditor,
  target: monaco.editor.ICodeEditor,
): number | undefined {
  const visibleLine = source.getVisibleRanges()[0]?.startLineNumber;
  if (visibleLine === undefined || !source.getModel() || !target.getModel()) return undefined;
  const reverse = group.editors.get(source) === "result";
  const scrollTop = source.getScrollTop();
  const count = lineCount(source);
  let range = projectScrollLine(group.mappings, Math.max(1, visibleLine - 1), reverse);
  while (range.sourceEnd <= count && scrollTop >= lineTop(source, range.sourceEnd))
    range = projectScrollLine(group.mappings, range.sourceEnd, reverse);
  return interpolateScrollTop(
    scrollTop,
    lineTop(source, range.sourceStart),
    lineEnd(source, range.sourceEnd),
    range.targetStartGap
      ? gapTop(target, range.targetStart)
      : lineTop(target, range.targetStart),
    range.targetEndGap ? gapTop(target, range.targetEnd) : lineEnd(target, range.targetEnd),
  );
}

export function syncScrollGroup(
  group: ScrollSyncGroup,
  source = group.lastScrolled ?? group.editors.keys().next().value,
  vertical = true,
  horizontal = true,
): void {
  if (!group.enabled || group.syncing || !source || !group.editors.has(source)) return;
  group.syncing = true;
  try {
    for (const [target, role] of group.editors) {
      if (target === source) continue;
      const scrollTop = vertical
        ? role === group.editors.get(source)
          ? source.getScrollTop()
          : mappedScrollTop(group, source, target)
        : undefined;
      target.setScrollPosition({
        scrollTop,
        scrollLeft: horizontal ? source.getScrollLeft() : undefined,
      });
    }
  } finally {
    group.syncing = false;
  }
}

export function joinScrollSyncGroup(
  group: ScrollSyncGroup,
  editor: monaco.editor.ICodeEditor,
  role: ScrollSyncRole = "source",
): () => void {
  group.editors.set(editor, role);
  const listener = editor.onDidScrollChange((event) => {
    if (!group.enabled || group.syncing || !(event.scrollTopChanged || event.scrollLeftChanged))
      return;
    group.lastScrolled = editor;
    syncScrollGroup(group, editor, event.scrollTopChanged, event.scrollLeftChanged);
  });
  const zones = editor.onDidChangeViewZones(() => syncScrollGroup(group));
  const focus = editor.onDidFocusEditorWidget(() => {
    group.lastScrolled = editor;
  });
  return () => {
    listener.dispose();
    zones.dispose();
    focus.dispose();
    group.editors.delete(editor);
    if (group.lastScrolled === editor) group.lastScrolled = null;
  };
}
