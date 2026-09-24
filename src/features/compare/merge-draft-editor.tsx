import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { DraftLineOrigin } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";
import "./merge-reference-editor.css";

export interface MergeDraftApi {
  goToLine: (line: number) => void;
}

interface Props {
  value: string;
  origins: (DraftLineOrigin | null)[];
  onChange: (value: string) => void;
  ref?: Ref<MergeDraftApi>;
}

export function MergeDraftEditor({ value, origins, onChange, ref }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const callback = useRef(onChange);
  const syncing = useRef(false);
  const { resolvedTheme } = useTheme();
  callback.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const model = monaco.editor.createModel("", "sql");
    const instance = monaco.editor.create(container.current, {
      model,
      theme: "l8db-light",
      automaticLayout: true,
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
    const subscription = model.onDidChangeContent(() => {
      if (!syncing.current) callback.current(model.getValue());
    });
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    return () => {
      decorations.current = null;
      subscription.dispose();
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model || model.getValue() === value) return;
    syncing.current = true;
    model.setValue(value);
    syncing.current = false;
  }, [value]);

  useEffect(() => {
    decorations.current?.set(
      origins.flatMap((origin, line) =>
        origin
          ? [
              {
                range: new monaco.Range(line + 1, 1, line + 1, 1),
                options: { isWholeLine: true, className: `merge-origin-${origin}` },
              },
            ]
          : [],
      ),
    );
  }, [origins]);

  useEffect(() => {
    if (editor.current)
      monaco.editor.setTheme(resolvedTheme === "dark" ? "l8db-dark" : "l8db-light");
  }, [resolvedTheme]);

  useImperativeHandle(ref, () => ({
    goToLine(line) {
      const instance = editor.current;
      if (!instance) return;
      const position = Math.min(Math.max(line, 1), instance.getModel()?.getLineCount() ?? 1);
      instance.revealLineInCenter(position);
      instance.setPosition({ lineNumber: position, column: 1 });
      instance.focus();
    },
  }));

  return <div ref={container} className="merge-draft-editor h-full min-h-0 w-full" />;
}
