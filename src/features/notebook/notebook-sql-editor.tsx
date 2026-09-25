import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { monaco, overflowWidgetsDomNode } from "@/lib/monaco";
import { attachSqlIntellisense } from "@/lib/monaco-intellisense";

const MIN_HEIGHT = 72;
const MAX_HEIGHT = 480;

export function NotebookSqlEditor({
  value,
  onChange,
  onRun,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "l8db-dark" : "l8db-light";
  const initial = useRef({ value, theme });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, {
      value: initial.current.value,
      language: "sql",
      theme: initial.current.theme,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 4,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
      },
    });
    editorRef.current = editor;
    const resize = () => {
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, editor.getContentHeight()));
      container.style.height = `${height}px`;
      editor.layout();
    };
    resize();
    const size = editor.onDidContentSizeChange(resize);
    const change = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());
    const intellisense = attachSqlIntellisense(editor);
    return () => {
      size.dispose();
      change.dispose();
      intellisense.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={containerRef} className="w-full overflow-hidden rounded-md border" />;
}
