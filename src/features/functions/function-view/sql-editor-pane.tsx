import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { VimStatusLine } from "@/components/editor/vim-status-line";
import { addSqlFormatAction, attachPlsqlLint, monaco, showSqlError } from "@/lib/monaco";
import { useEditorKeymap } from "@/lib/monaco/use-editor-keymap";
import { attachSqlIntellisense } from "@/lib/monaco-intellisense";
import { themeFor } from "./theme-for";

export interface SqlEditorPaneProps {
  value: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
  revealLine?: number;
  error?: string | null;
}

export function SqlEditorPane({
  value,
  readOnly,
  onChange,
  revealLine,
  error,
}: SqlEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const [externalValueVersion, setExternalValueVersion] = useState(0);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "plsql",
      theme: themeFor(resolvedTheme),
      readOnly,
      domReadOnly: readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      lineHeight: 24,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
      tabSize: 2,
    });

    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    const formatAction = addSqlFormatAction(editor);
    const intellisense = attachSqlIntellisense(editor);
    const plsqlLint = attachPlsqlLint(editor);

    return () => {
      changeSub.dispose();
      plsqlLint.dispose();
      formatAction.dispose();
      intellisense.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  const vimEnabled = useEditorKeymap(editorRef, vimStatusRef);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ readOnly, domReadOnly: readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
      setExternalValueVersion((v) => v + 1);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) showSqlError(editor, error ? { message: error } : null);
  }, [error, externalValueVersion]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealLine) return;
    editor.revealLineInCenter(revealLine);
    editor.setPosition({ lineNumber: revealLine, column: 1 });
    const decorations = editor.createDecorationsCollection();
    const range = new monaco.Range(revealLine, 1, revealLine, 1);
    const timers = [0, 1, 2].flatMap((i) => [
      setTimeout(
        () =>
          decorations.set([{ range, options: { isWholeLine: true, className: "sql-flash-line" } }]),
        i * 400,
      ),
      setTimeout(() => decorations.clear(), i * 400 + 200),
    ]);
    return () => {
      timers.forEach(clearTimeout);
      decorations.clear();
    };
  }, [revealLine, externalValueVersion]);

  return (
    <div className="flex size-full min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1" />
      {vimEnabled && <VimStatusLine ref={vimStatusRef} />}
    </div>
  );
}
