import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { monaco } from "@/lib/monaco";
import { cn } from "@/lib/utils";

interface SqlCodeViewProps {
  value: string;
  className?: string;
}

export function SqlCodeView({ value, className }: SqlCodeViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "l8db-dark" : "l8db-light";

  useEffect(() => {
    if (!container.current) return;
    const model = monaco.editor.createModel("", "sql");
    const instance = monaco.editor.create(container.current, {
      model,
      readOnly: true,
      domReadOnly: true,
      wordWrap: "on",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      folding: false,
      lineNumbersMinChars: 3,
      overviewRulerLanes: 0,
      contextmenu: false,
      fontSize: 13,
      lineHeight: 20,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });
    editor.current = instance;
    return () => {
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={container} className={cn("min-h-0", className)} />;
}
