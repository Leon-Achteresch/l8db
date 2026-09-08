import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

import { monaco } from "@/lib/monaco";

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
  ref?: Ref<DefinitionDiffApi>;
}

export function DefinitionDiffEditor({
  original,
  modified,
  onlyDifferences,
  onStats,
  ref,
}: DefinitionDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const indexRef = useRef(-1);
  const statsRef = useRef<((stats: DiffStats) => void) | undefined>(onStats);
  const { resolvedTheme } = useTheme();

  statsRef.current = onStats;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.createDiffEditor(container, {
      theme: themeFor(resolvedTheme),
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      renderOverviewRuler: true,
      minimap: { enabled: false },
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
    const originalModel = monaco.editor.createModel("", "sql");
    const modifiedModel = monaco.editor.createModel("", "sql");
    editor.setModel({ original: originalModel, modified: modifiedModel });
    diffRef.current = editor;

    const subscription = editor.onDidUpdateDiff(() => {
      indexRef.current = -1;
      statsRef.current?.(diffStats(editor.getLineChanges() ?? []));
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      diffRef.current = null;
    };
  }, []);

  useEffect(() => {
    const models = diffRef.current?.getModel();
    if (!models) return;
    if (models.original.getValue() !== original) models.original.setValue(original);
    if (models.modified.getValue() !== modified) models.modified.setValue(modified);
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
      const next = (indexRef.current + direction + changes.length * 2) % changes.length;
      indexRef.current = next;
      const change = changes[next];
      const line = change.modifiedStartLineNumber || change.originalStartLineNumber || 1;
      const target = editor.getModifiedEditor();
      target.revealLineInCenter(line);
      target.setPosition({ lineNumber: line, column: 1 });
      target.focus();
    },
  }));

  return <div ref={containerRef} className="h-full w-full min-h-0" />;
}
