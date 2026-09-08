import { type Hotkey, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

import type { ColumnInfo, TableInfo } from "@/lib/db";
import { buildEditorOptions } from "@/lib/editor-options";
import { commandById, useHotkeysStore } from "@/lib/hotkeys";
import { addSqlFormatAction, monaco, overflowWidgetsDomNode } from "@/lib/monaco";
import { attachSqlIntellisense } from "@/lib/monaco-intellisense";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useSettingsStore } from "@/lib/settings";
import { toMonacoSnippet } from "@/lib/snippets";
import { lintUnknownTables } from "@/lib/sql-lint";

export interface QueryEditorApi {
  insertSnippet: (body: string) => void;
  insertText: (text: string) => void;
  focus: () => void;
  action: (id: string) => void;
  format: () => void;
  toggleComment: () => void;
  revealMatch: (line: number, column?: number, length?: number) => void;
  toggleBookmark: () => void;
  gotoBookmark: (direction: "next" | "previous") => void;
}

export interface EditorPosition {
  line: number;
  column: number;
  offset: number;
}

interface SchemaRegistry {
  schemas: string[];
  tables: TableInfo[];
  columns: ColumnInfo[];
}

interface EditorHighlight {
  start: number;
  end: number;
}

interface QueryEditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave?: () => void;
  onRunSelection?: () => void;
  onRunStatement?: () => void;
  onSelectionChange?: (selectedText: string) => void;
  onCursorChange?: (offset: number) => void;
  onPositionChange?: (position: EditorPosition) => void;
  highlight?: EditorHighlight | null;
  bookmarks?: number[];
  onBookmarksChange?: (lines: number[]) => void;
  onSearchTabs?: () => void;
  registry: SchemaRegistry;
  ref?: Ref<QueryEditorApi>;
  className?: string;
}

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

function refreshLintMarkers(editor: monaco.editor.IStandaloneCodeEditor, registry: SchemaRegistry) {
  const model = editor.getModel();
  if (!model) return;
  const findings = lintUnknownTables(model.getValue(), registry.tables);
  monaco.editor.setModelMarkers(
    model,
    "l8db-sql-lint",
    findings.map((finding) => {
      const start = model.getPositionAt(finding.offset);
      const end = model.getPositionAt(finding.offset + finding.length);
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: finding.message,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      };
    }),
  );
}

export function QueryEditorPane({
  value,
  onChange,
  onRun,
  onSave,
  onRunSelection,
  onRunStatement,
  onSelectionChange,
  onCursorChange,
  onPositionChange,
  highlight,
  bookmarks,
  onBookmarksChange,
  onSearchTabs,
  registry,
  className,
  ref,
}: QueryEditorPaneProps) {
  const workspace = useQueryWorkspace();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const bookmarkDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const bookmarksRef = useRef<number[]>(bookmarks ?? []);
  const suppressPublishRef = useRef(false);
  const onBookmarksChangeRef = useRef(onBookmarksChange);
  const onSearchTabsRef = useRef(onSearchTabs);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const onRunSelectionRef = useRef(onRunSelection);
  const onRunStatementRef = useRef(onRunStatement);
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
  onSelectionChangeRef.current = onSelectionChange;
  onCursorChangeRef.current = onCursorChange;
  onPositionChangeRef.current = onPositionChange;
  onBookmarksChangeRef.current = onBookmarksChange;
  onSearchTabsRef.current = onSearchTabs;
  registryRef.current = registry;
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontLigatures = useSettingsStore((s) => s.editorFontLigatures);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const editorTabSize = useSettingsStore((s) => s.editorTabSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const editorWrappingIndent = useSettingsStore((s) => s.editorWrappingIndent);
  const editorLineNumbers = useSettingsStore((s) => s.editorLineNumbers);
  const editorMinimap = useSettingsStore((s) => s.editorMinimap);
  const editorMinimapScale = useSettingsStore((s) => s.editorMinimapScale);
  const editorBracketPairColorization = useSettingsStore((s) => s.editorBracketPairColorization);
  const editorGuidesBracketPairs = useSettingsStore((s) => s.editorGuidesBracketPairs);
  const editorGuidesIndentation = useSettingsStore((s) => s.editorGuidesIndentation);
  const editorRenderWhitespace = useSettingsStore((s) => s.editorRenderWhitespace);
  const editorRulers = useSettingsStore((s) => s.editorRulers);
  const editorSmoothScrolling = useSettingsStore((s) => s.editorSmoothScrolling);
  const editorQuickSuggestions = useSettingsStore((s) => s.editorQuickSuggestions);
  const editorSuggestOnTriggerCharacters = useSettingsStore(
    (s) => s.editorSuggestOnTriggerCharacters,
  );
  const editorSuggestDelay = useSettingsStore((s) => s.editorSuggestDelay);
  const editorAcceptSuggestionOnEnter = useSettingsStore((s) => s.editorAcceptSuggestionOnEnter);
  const editorTabCompletion = useSettingsStore((s) => s.editorTabCompletion);
  const editorParameterHints = useSettingsStore((s) => s.editorParameterHints);
  const editorFormatOnPaste = useSettingsStore((s) => s.editorFormatOnPaste);
  const editorFormatOnType = useSettingsStore((s) => s.editorFormatOnType);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: themeFor(resolvedTheme),
      automaticLayout: true,
      ...buildEditorOptions({
        editorFontSize,
        editorFontFamily,
        editorFontLigatures,
        editorLineHeight,
        editorTabSize,
        editorWordWrap,
        editorWrappingIndent,
        editorLineNumbers,
        editorMinimap,
        editorMinimapScale,
        editorBracketPairColorization,
        editorGuidesBracketPairs,
        editorGuidesIndentation,
        editorRenderWhitespace,
        editorRulers,
        editorSmoothScrolling,
        editorQuickSuggestions,
        editorSuggestOnTriggerCharacters,
        editorSuggestDelay,
        editorAcceptSuggestionOnEnter,
        editorTabCompletion,
        editorParameterHints,
        editorFormatOnPaste,
        editorFormatOnType,
      }),
      glyphMargin: true,
      folding: true,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      padding: { top: 16, bottom: 16 },
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode,
    });

    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection([]);
    bookmarkDecorationsRef.current = editor.createDecorationsCollection([]);
    applyBookmarks(bookmarksRef.current);
    refreshLintMarkers(editor, registryRef.current);

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
      publishBookmarks();
      if (lintTimer) clearTimeout(lintTimer);
      lintTimer = setTimeout(() => {
        const current = editorRef.current;
        if (current) refreshLintMarkers(current, registryRef.current);
      }, 500);
    });

    const keydown = (event: KeyboardEvent) => {
      const overrides = useHotkeysStore.getState().overrides;
      const actions: Record<string, () => void> = {
        "query.run": () => onRunRef.current(),
        "query.runSelection": () => onRunSelectionRef.current?.(),
        "query.runStatement": () => onRunStatementRef.current?.(),
        "query.save": () => onSaveRef.current?.(),
        "query.format": () => {
          void editor.getAction("l8db.format-sql")?.run();
        },
        "query.comment": () => {
          void editor.getAction("editor.action.commentLine")?.run();
        },
        "query.bookmark": toggleBookmarkAtCursor,
        "query.nextBookmark": () => gotoBookmarkLine("next"),
        "query.prevBookmark": () => gotoBookmarkLine("previous"),
      };
      for (const [id, action] of Object.entries(actions)) {
        const command = commandById(id);
        if (!command) continue;
        const keys =
          overrides[id] === undefined
            ? [command.defaultHotkey, ...(command.aliases ?? [])]
            : [overrides[id]];
        if (!keys.some((key) => key && matchesKeyboardEvent(event, key as Hotkey))) continue;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) action();
        return;
      }
      for (const id of ["query.format", "query.comment"]) {
        const command = commandById(id);
        if (
          command &&
          overrides[id] !== undefined &&
          overrides[id] !== command.defaultHotkey &&
          matchesKeyboardEvent(event, command.defaultHotkey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    };
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
      intellisense.dispose();
      formatAction.dispose();
      decorationsRef.current = null;
      bookmarkDecorationsRef.current = null;
      const model = editor.getModel();
      editor.dispose();
      model?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      folding: workspace.folding,
      showFoldingControls: "always",
      stickyScroll: { enabled: workspace.stickyScroll },
      cursorStyle: workspace.cursorStyle,
      cursorBlinking: workspace.cursorBlinking,
      renderLineHighlight: workspace.highlightLine ? "line" : "none",
      scrollBeyondLastLine: workspace.scrollBeyondLastLine,
      autoClosingBrackets: workspace.autoClosing ? "languageDefined" : "never",
      autoClosingQuotes: workspace.autoClosing ? "languageDefined" : "never",
    });
    editor.getModel()?.updateOptions({ insertSpaces: workspace.insertSpaces });
  }, [workspace]);

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (!editor || !selection) return;
        editor.pushUndoStop();
        editor.executeEdits("schema-browser", [{ range: selection, text, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        editor.focus();
      },
      insertSnippet: (body: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        editor.trigger("l8db-snippets", "editor.action.insertSnippet", {
          snippet: toMonacoSnippet(body),
        });
      },
      focus: () => editorRef.current?.focus(),
      action: (id: string) => {
        editorRef.current?.focus();
        editorRef.current?.trigger("query-workspace", id, null);
      },
      format: () => {
        editorRef.current?.getAction("editor.action.formatDocument")?.run();
      },
      toggleComment: () => {
        editorRef.current?.getAction("editor.action.commentLine")?.run();
      },
      revealMatch: (line: number, column = 1, length = 0) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) return;
        const targetLine = Math.max(1, Math.min(line, model.getLineCount()));
        const maxColumn = model.getLineMaxColumn(targetLine);
        const startColumn = Math.max(1, Math.min(column, maxColumn));
        const endColumn = Math.max(startColumn, Math.min(startColumn + length, maxColumn));
        editor.setSelection(new monaco.Range(targetLine, startColumn, targetLine, endColumn));
        editor.revealLineInCenter(targetLine);
        editor.focus();
      },
      toggleBookmark: () => toggleBookmarkAtCursor(),
      gotoBookmark: (direction: "next" | "previous") => gotoBookmarkLine(direction),
    }),
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
    const editor = editorRef.current;
    const decorations = decorationsRef.current;
    const model = editor?.getModel();
    if (!decorations || !model) return;
    if (!highlight || highlight.end <= highlight.start || highlight.end > model.getValueLength()) {
      decorations.clear();
      return;
    }
    const start = model.getPositionAt(highlight.start);
    const end = model.getPositionAt(highlight.end);
    decorations.set([
      {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          className: "l8db-statement-highlight",
          isWholeLine: false,
        },
      },
    ]);
  }, [highlight]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      suppressPublishRef.current = true;
      editor.setValue(value);
      suppressPublishRef.current = false;
      applyBookmarks(bookmarksRef.current);
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) refreshLintMarkers(editor, registry);
  }, [registry]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions(
      buildEditorOptions({
        editorFontSize,
        editorFontFamily,
        editorFontLigatures,
        editorLineHeight,
        editorTabSize,
        editorWordWrap,
        editorWrappingIndent,
        editorLineNumbers,
        editorMinimap,
        editorMinimapScale,
        editorBracketPairColorization,
        editorGuidesBracketPairs,
        editorGuidesIndentation,
        editorRenderWhitespace,
        editorRulers,
        editorSmoothScrolling,
        editorQuickSuggestions,
        editorSuggestOnTriggerCharacters,
        editorSuggestDelay,
        editorAcceptSuggestionOnEnter,
        editorTabCompletion,
        editorParameterHints,
        editorFormatOnPaste,
        editorFormatOnType,
      }),
    );
  }, [
    editorFontSize,
    editorFontFamily,
    editorFontLigatures,
    editorLineHeight,
    editorTabSize,
    editorWordWrap,
    editorWrappingIndent,
    editorLineNumbers,
    editorMinimap,
    editorMinimapScale,
    editorBracketPairColorization,
    editorGuidesBracketPairs,
    editorGuidesIndentation,
    editorRenderWhitespace,
    editorRulers,
    editorSmoothScrolling,
    editorQuickSuggestions,
    editorSuggestOnTriggerCharacters,
    editorSuggestDelay,
    editorAcceptSuggestionOnEnter,
    editorTabCompletion,
    editorParameterHints,
    editorFormatOnPaste,
    editorFormatOnType,
  ]);

  return <div ref={containerRef} className={className ?? "size-full"} />;
}
