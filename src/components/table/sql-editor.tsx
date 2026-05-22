import { useEffect, useRef } from "react";

import { useTheme } from "next-themes";

import { monaco } from "@/lib/monaco";
import { cn } from "@/lib/utils";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  columns?: string[];
  placeholder?: string;
  className?: string;
}

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export function SqlEditor({
  value,
  onChange,
  onSubmit,
  columns = [],
  placeholder,
  className,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const columnsRef = useRef(columns);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  columnsRef.current = columns;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: themeFor(resolvedTheme),
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 6,
      lineNumbersMinChars: 0,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 12,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: "auto",
        horizontal: "hidden",
        useShadows: false,
        verticalScrollbarSize: 8,
      },
      contextmenu: false,
      tabSize: 2,
      fixedOverflowWidgets: true,
      placeholder,
    });
    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onSubmitRef.current?.();
    });

    const completion = monaco.languages.registerCompletionItemProvider("sql", {
      provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: columnsRef.current.map((column) => ({
            label: column,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: "Spalte",
            insertText: /^[a-z_][a-z0-9_]*$/i.test(column)
              ? column
              : `"${column.replace(/"/g, '""')}"`,
            range,
          })),
        };
      },
    });

    return () => {
      changeSub.dispose();
      completion.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-input bg-transparent py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
