import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { monaco } from "@/lib/monaco";

export function SqlEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "l8db-dark" : "l8db-light";
  const initial = useRef({ value, theme });

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: initial.current.value,
      language: "sql",
      theme: initial.current.theme,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 8,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 12,
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    return () => {
      sub.dispose();
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

  return <div ref={containerRef} className={className} />;
}
