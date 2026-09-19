import { useTheme } from "next-themes";
import { useEffect, useImperativeHandle, useRef } from "react";

import { buildEditorOptions } from "@/lib/editor-options";
import { addSqlFormatAction, attachPlsqlLint, monaco, showSqlError } from "@/lib/monaco";
import { attachSqlIntellisense } from "@/lib/monaco-intellisense";
import type { BookmarkSlots } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

import { createEditorApi } from "./query-editor-pane/create-editor-api";
import { createEditorKeydown } from "./query-editor-pane/create-editor-keydown";
import {
  refreshLintMarkers,
  STATIC_EDITOR_OPTIONS,
  themeFor,
} from "./query-editor-pane/editor-utils";
import type { QueryEditorPaneProps } from "./query-editor-pane/types";
import { useEditorBookmarks } from "./query-editor-pane/use-editor-bookmarks";
import { useEditorOptionsSync } from "./query-editor-pane/use-editor-options-sync";
import { useEditorSettings } from "./query-editor-pane/use-editor-settings";
import { useStatementHighlight } from "./query-editor-pane/use-statement-highlight";
import { useViewStatePersistence } from "./query-editor-pane/use-view-state-persistence";
import { useWorkspaceEditorOptions } from "./query-editor-pane/use-workspace-editor-options";

export type { EditorPosition, QueryEditorApi } from "./query-editor-pane/types";

export function QueryEditorPane({
  value,
  language = "sql",
  onChange,
  onRun,
  onSave,
  onRunSelection,
  onRunStatement,
  onCheck,
  onSelectionChange,
  onCursorChange,
  onPositionChange,
  highlight,
  error,
  bookmarks,
  onBookmarksChange,
  bookmarkSlots,
  onBookmarkSlotChange,
  onSearchTabs,
  stateKey,
  registry,
  className,
  ref,
}: QueryEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const onSearchTabsRef = useRef(onSearchTabs);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const onRunSelectionRef = useRef(onRunSelection);
  const onRunStatementRef = useRef(onRunStatement);
  const onCheckRef = useRef(onCheck);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const registryRef = useRef(registry);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onSaveRef.current = onSave;
  onRunSelectionRef.current = onRunSelection;
  onRunStatementRef.current = onRunStatement;
  onCheckRef.current = onCheck;
  onSelectionChangeRef.current = onSelectionChange;
  onCursorChangeRef.current = onCursorChange;
  onPositionChangeRef.current = onPositionChange;
  onSearchTabsRef.current = onSearchTabs;
  registryRef.current = registry;
  const editorSettings = useEditorSettings();
  const {
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
  } = useEditorBookmarks({
    editorRef,
    bookmarks,
    bookmarkSlots,
    onBookmarksChange,
    onBookmarkSlotChange,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language,
      theme: themeFor(resolvedTheme),
      automaticLayout: true,
      ...buildEditorOptions(editorSettings),
      ...STATIC_EDITOR_OPTIONS,
    });

    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection([]);
    bookmarkDecorationsRef.current = editor.createDecorationsCollection([]);
    slotDecorationsRef.current = Array.from({ length: 9 }, () =>
      editor.createDecorationsCollection([]),
    );
    applyBookmarks(bookmarksRef.current);
    applySlots(slotsRef.current);
    refreshLintMarkers(editor, registryRef.current);
    const plsqlLint = attachPlsqlLint(editor);

    const selectionSub = editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      if (!model) return;
      onSelectionChangeRef.current?.(model.getValueInRange(event.selection));
      const position = event.selection.getPosition();
      const offset = model.getOffsetAt(position);
      onCursorChangeRef.current?.(offset);
      onPositionChangeRef.current?.({
        line: position.lineNumber,
        column: position.column,
        offset,
      });
    });

    let lintTimer: ReturnType<typeof setTimeout> | null = null;
    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
      publishSlots();
      publishBookmarks();
      if (lintTimer) clearTimeout(lintTimer);
      lintTimer = setTimeout(() => {
        const current = editorRef.current;
        if (current) refreshLintMarkers(current, registryRef.current);
      }, 500);
    });

    const keydown = createEditorKeydown({
      editor,
      setSlotAtCursor,
      gotoSlotLine,
      toggleBookmarkAtCursor,
      gotoBookmarkLine,
      onRun: () => onRunRef.current(),
      onRunSelection: () => onRunSelectionRef.current?.(),
      onRunStatement: () => onRunStatementRef.current?.(),
      onCheck: () => onCheckRef.current?.(),
      onSave: () => onSaveRef.current?.(),
    });
    container.addEventListener("keydown", keydown, true);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      onSearchTabsRef.current?.();
    });

    const formatAction = addSqlFormatAction(editor);

    const intellisense = attachSqlIntellisense(editor);

    return () => {
      if (lintTimer) clearTimeout(lintTimer);
      container.removeEventListener("keydown", keydown, true);
      changeSub.dispose();
      selectionSub.dispose();
      plsqlLint.dispose();
      intellisense.dispose();
      formatAction.dispose();
      decorationsRef.current = null;
      bookmarkDecorationsRef.current = null;
      slotDecorationsRef.current = [];
      const model = editor.getModel();
      editor.dispose();
      model?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) showSqlError(editor, error ?? null);
  }, [error]);

  useWorkspaceEditorOptions(editorRef);

  useImperativeHandle(
    ref,
    () => createEditorApi(editorRef, toggleBookmarkAtCursor, gotoBookmarkLine),
    [],
  );

  useEffect(() => {
    const next = bookmarks ?? [];
    const current = readBookmarkLines();
    if (next.length === current.length && next.every((line, i) => line === current[i])) {
      bookmarksRef.current = current;
      return;
    }
    bookmarksRef.current = next;
    applyBookmarks(next);
  }, [bookmarks]);

  useEffect(() => {
    const next = bookmarkSlots ?? {};
    const current: BookmarkSlots = {};
    for (let slot = 1; slot <= 9; slot += 1) {
      const line = readSlotLine(slot);
      if (line !== null) current[String(slot)] = line;
    }
    const keys = new Set([...Object.keys(next), ...Object.keys(current)]);
    let equal = true;
    for (const key of keys) {
      if ((next[key] ?? null) !== (current[key] ?? null)) {
        equal = false;
        break;
      }
    }
    if (equal) {
      slotsRef.current = current;
      return;
    }
    slotsRef.current = { ...next };
    applySlots(next);
  }, [bookmarkSlots]);

  useStatementHighlight(editorRef, decorationsRef, highlight);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      suppressPublishRef.current = true;
      editor.setValue(value);
      suppressPublishRef.current = false;
      applyBookmarks(bookmarksRef.current);
      applySlots(slotsRef.current);
    }
  }, [value]);

  useViewStatePersistence(editorRef, stateKey);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
    if (editor) refreshLintMarkers(editor, registry);
  }, [registry, language]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useEditorOptionsSync(editorRef, editorSettings);

  return <div ref={containerRef} className={cn("relative", className ?? "size-full")} />;
}
