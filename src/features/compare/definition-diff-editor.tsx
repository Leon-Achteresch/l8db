import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/features/diffEditorBreadcrumbs/register";

import { diffChangeLines, nextDiffLine } from "@/features/compare/diff-navigation";
import { monaco } from "@/lib/monaco";
import "./definition-diff-editor.css";

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export interface DefinitionDiffApi {
  goToChange: (direction: 1 | -1) => void;
}

export interface DiffStats {
  changes: number;
  added: number;
  removed: number;
}

export function diffStats(changes: readonly monaco.editor.ILineChange[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    if (change.originalEndLineNumber > 0) {
      removed += change.originalEndLineNumber - change.originalStartLineNumber + 1;
    }
    if (change.modifiedEndLineNumber > 0) {
      added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
    }
  }
  return { changes: changes.length, added, removed };
}

interface DefinitionDiffEditorProps {
  original: string;
  modified: string;
  onlyDifferences: boolean;
  onStats?: (stats: DiffStats) => void;
  onModifiedChange?: (value: string) => void;
  readOnly?: boolean;
  minimap?: boolean;
  ref?: Ref<DefinitionDiffApi>;
}

export function DefinitionDiffEditor({
  original,
  modified,
  onlyDifferences,
  onStats,
  onModifiedChange,
  readOnly = false,
  minimap = false,
  ref,
}: DefinitionDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const activeSideRef = useRef<"original" | "modified">("modified");
  const statsRef = useRef<((stats: DiffStats) => void) | undefined>(onStats);
  const { resolvedTheme } = useTheme();

  const modifiedCallback = useRef(onModifiedChange);
  modifiedCallback.current = onModifiedChange;
  statsRef.current = onStats;
  const readOnlyRef = useRef(readOnly);
  const minimapRef = useRef(minimap);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.createDiffEditor(container, {
      theme: themeFor(resolvedTheme),
      readOnly: readOnlyRef.current,
      renderMarginRevertIcon: !readOnlyRef.current,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      renderOverviewRuler: true,
      minimap: { enabled: minimapRef.current, renderCharacters: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineHeight: 22,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      padding: { top: 12, bottom: 12 },
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });
    diffRef.current = editor;

    const originalFocus = editor.getOriginalEditor().onDidFocusEditorText(() => {
      activeSideRef.current = "original";
    });
    const modifiedFocus = editor.getModifiedEditor().onDidFocusEditorText(() => {
      activeSideRef.current = "modified";
    });
    const subscription = editor.onDidUpdateDiff(() => {
      statsRef.current?.(diffStats(editor.getLineChanges() ?? []));
    });

    return () => {
      originalFocus.dispose();
      modifiedFocus.dispose();
      subscription.dispose();
      const models = editor.getModel();
      editor.dispose();
      models?.original.dispose();
      models?.modified.dispose();
      diffRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = diffRef.current;
    if (!editor) return;
    const previous = editor.getModel();
    if (
      previous &&
      previous.original.getValue() === original &&
      previous.modified.getValue() === modified
    )
      return;
    const modifiedModel = monaco.editor.createModel(modified, "sql");
    editor.setModel({
      original: monaco.editor.createModel(original, "sql"),
      modified: modifiedModel,
    });
    previous?.original.dispose();
    previous?.modified.dispose();
    const listener = modifiedModel.onDidChangeContent(() => {
      modifiedCallback.current?.(modifiedModel.getValue());
    });
    return () => listener.dispose();
  }, [original, modified]);

  useEffect(() => {
    diffRef.current?.updateOptions({
      hideUnchangedRegions: {
        enabled: onlyDifferences,
        contextLineCount: 1,
        minimumLineCount: 1,
        revealLineCount: 5,
      },
    });
  }, [onlyDifferences]);

  useEffect(() => {
    if (diffRef.current) monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useImperativeHandle(ref, () => ({
    goToChange(direction) {
      const editor = diffRef.current;
      const changes = editor?.getLineChanges();
      if (!editor || !changes || changes.length === 0) return;
      const side = activeSideRef.current;
      const target = side === "original" ? editor.getOriginalEditor() : editor.getModifiedEditor();
      const line = nextDiffLine(
        diffChangeLines(changes, side),
        target.getPosition()?.lineNumber ?? 1,
        direction,
        target.getModel()?.getLineCount() ?? 1,
      );
      if (line === null) return;
      target.revealLineInCenter(line);
      target.setPosition({ lineNumber: line, column: 1 });
      target.focus();
    },
  }));

  return <div ref={containerRef} className="definition-diff-editor h-full w-full min-h-0" />;
}
