import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { nextDiffLine } from "@/features/compare/diff-navigation";
import type { DraftLineOrigin } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";
import { joinScrollSyncGroup, type ScrollSyncGroup } from "@/lib/monaco/scroll-sync";
import "./merge-reference-editor.css";

export interface MergeDraftApi {
  goToChange: (lines: readonly number[], direction: 1 | -1) => void;
}

interface Props {
  value: string;
  origins: (DraftLineOrigin | null)[];
  onChange: (value: string) => void;
  onActivate?: () => void;
  ref?: Ref<MergeDraftApi>;
  scrollSync?: ScrollSyncGroup;
}

export function MergeDraftEditor({ value, origins, onChange, onActivate, ref, scrollSync }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const callback = useRef(onChange);
  const syncing = useRef(false);
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const { resolvedTheme } = useTheme();
  callback.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const model = monaco.editor.createModel("", "sql");
    const instance = monaco.editor.create(container.current, {
      model,
      theme: "l8db-light",
      automaticLayout: true,
      minimap: { enabled: true, renderCharacters: false },
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
    const focus = instance.onDidFocusEditorWidget(() => activateRef.current?.());
    const leaveScrollSync = scrollSync && joinScrollSyncGroup(scrollSync, instance, "result");
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    return () => {
      leaveScrollSync?.();
      decorations.current = null;
      subscription.dispose();
      focus.dispose();
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, [scrollSync]);

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
    goToChange(lines, direction) {
      const instance = editor.current;
      if (!instance) return;
      const position = nextDiffLine(
        lines,
        instance.getPosition()?.lineNumber ?? 1,
        direction,
        instance.getModel()?.getLineCount() ?? 1,
      );
      if (position === null) return;
      instance.revealLineInCenter(position);
      instance.setPosition({ lineNumber: position, column: 1 });
      instance.focus();
    },
  }));

  return <div ref={container} className="merge-draft-editor h-full min-h-0 w-full" />;
}
