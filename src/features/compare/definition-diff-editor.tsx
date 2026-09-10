import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

import { monaco } from "@/lib/monaco";

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export interface DefinitionDiffApi {
  goToChange: (direction: 1 | -1) => void;
}

interface DefinitionDiffEditorProps {
  original: string;
  modified: string;
  onlyDifferences: boolean;
  onChangeCount?: (count: number) => void;
  ref?: Ref<DefinitionDiffApi>;
}

export function DefinitionDiffEditor({
  original,
  modified,
  onlyDifferences,
  onChangeCount,
  ref,
}: DefinitionDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const indexRef = useRef(-1);
  const countRef = useRef<((count: number) => void) | undefined>(onChangeCount);
  const { resolvedTheme } = useTheme();

  countRef.current = onChangeCount;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.createDiffEditor(container, {
      theme: themeFor(resolvedTheme),
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      renderOverviewRuler: false,
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
      countRef.current?.(editor.getLineChanges()?.length ?? 0);
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
      hideUnchangedRegions: { enabled: onlyDifferences },
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
