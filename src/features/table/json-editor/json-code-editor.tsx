import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { monaco } from "@/lib/monaco";

type Props = {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
};

export default function JsonCodeEditor({ value, readOnly, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "l8db-dark" : "l8db-light";
  const initial = useRef({ value, theme, readOnly });

  useEffect(() => {
    if (!containerRef.current) return;
    const model = monaco.editor.createModel(initial.current.value, "json");
    const editor = monaco.editor.create(containerRef.current, {
      model,
      theme: initial.current.theme,
      readOnly: initial.current.readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineNumbersMinChars: 3,
      tabSize: 2,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      folding: true,
      showFoldingControls: "always",
      stickyScroll: { enabled: true },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: "active", indentation: true },
      formatOnPaste: true,
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    editor.focus();
    return () => {
      sub.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || model.getValue() === value) return;
    editor.pushUndoStop();
    editor.executeEdits("l8db-json", [{ range: model.getFullModelRange(), text: value }]);
    editor.pushUndoStop();
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full" data-testid="json-code-editor" />;
}
