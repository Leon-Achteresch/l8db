import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { VimStatusLine } from "@/components/editor/vim-status-line";
import { addSqlFormatAction, attachPlsqlLint, monaco, showSqlError } from "@/lib/monaco";
import { useEditorKeymap } from "@/lib/monaco/use-editor-keymap";
import { themeFor } from "./theme-for";

export interface TriggerEditorPaneProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  errorPrefix: string;
}

export function TriggerEditorPane({ value, onChange, error, errorPrefix }: TriggerEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "plsql",
      theme: themeFor(resolvedTheme),
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
    const plsqlLint = attachPlsqlLint(editor);

    return () => {
      changeSub.dispose();
      plsqlLint.dispose();
      formatAction.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  const vimEnabled = useEditorKeymap(editorRef, vimStatusRef);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    showSqlError(
      editor,
      error
        ? { message: error, text: errorPrefix + editor.getValue(), base: -errorPrefix.length }
        : null,
    );
  }, [error]);

  return (
    <div className="flex size-full min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1" />
      {vimEnabled && <VimStatusLine ref={vimStatusRef} />}
    </div>
  );
}
