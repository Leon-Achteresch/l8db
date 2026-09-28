import { autocompletion, type Completion, completionKeymap } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, placeholder as editorPlaceholder, keymap } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { editorFontStack, editorLineHeightPx } from "@/lib/editor-options";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  columns?: string[];
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

const language = new Compartment();
const appearance = new Compartment();
const editable = new Compartment();
const hint = new Compartment();
const EMPTY_COLUMNS: string[] = [];

function columnCompletions(columns: string[]): Completion[] {
  return columns.map((name) => ({
    label: name,
    type: "property",
    detail: "Spalte",
    apply: /^[a-z_][a-z0-9_]*$/i.test(name) ? name : `"${name.replace(/"/g, '""')}"`,
  }));
}

function editorAppearance(family: string, size: number, lineHeight: number, dark: boolean) {
  return EditorView.theme(
    {
      "&": { height: "100%", backgroundColor: "transparent", color: "var(--foreground)" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { overflow: "auto", fontFamily: family, fontSize: `${size}px` },
      ".cm-content": { minHeight: "100%", lineHeight: `${lineHeight}px`, padding: "8px 0" },
      ".cm-gutters": { backgroundColor: "transparent", border: "none" },
      ".cm-activeLine": { backgroundColor: "transparent" },
    },
    { dark },
  );
}

export function SqlEditor({
  value,
  onChange,
  onSubmit,
  columns = EMPTY_COLUMNS,
  placeholder,
  className,
  readOnly = false,
  autoFocus = false,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const suppressChangeRef = useRef(false);
  const columnSignature = JSON.stringify(columns);
  const { resolvedTheme } = useTheme();
  const editorFontFamily = useSettingsStore((state) => state.editorFontFamily);
  const editorFontSize = useSettingsStore((state) => state.editorFontSize);
  const editorLineHeight = useSettingsStore((state) => state.editorLineHeight);
  const initial = useRef({
    value,
    columns,
    placeholder,
    readOnly,
    editorFontFamily,
    editorFontSize,
    editorLineHeight,
    resolvedTheme,
  });

  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const settings = initial.current;
    const size = Math.min(settings.editorFontSize, 14);
    const editor = new EditorView({
      doc: settings.value,
      parent: container,
      extensions: [
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onSubmitRef.current?.();
              return true;
            },
          },
          {
            key: "Shift-Alt-f",
            run: (view) => {
              void import("./sql-editor-format").then(({ formatEditorSql }) =>
                formatEditorSql(view),
              );
              return true;
            },
          },
          ...completionKeymap,
        ]),
        minimalSetup,
        autocompletion(),
        language.of(sql({ schema: columnCompletions(settings.columns) })),
        appearance.of(
          editorAppearance(
            editorFontStack(settings.editorFontFamily),
            size,
            editorLineHeightPx(size, settings.editorLineHeight),
            settings.resolvedTheme === "dark",
          ),
        ),
        editable.of([
          EditorView.editable.of(!settings.readOnly),
          EditorState.readOnly.of(settings.readOnly),
        ]),
        hint.of(settings.placeholder ? editorPlaceholder(settings.placeholder) : []),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !suppressChangeRef.current)
            onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.state.doc.toString() === value) return;
    suppressChangeRef.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
    suppressChangeRef.current = false;
  }, [value]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: language.reconfigure(
        sql({ schema: columnCompletions(JSON.parse(columnSignature) as string[]) }),
      ),
    });
  }, [columnSignature]);

  useEffect(() => {
    const size = Math.min(editorFontSize, 14);
    editorRef.current?.dispatch({
      effects: appearance.reconfigure(
        editorAppearance(
          editorFontStack(editorFontFamily),
          size,
          editorLineHeightPx(size, editorLineHeight),
          resolvedTheme === "dark",
        ),
      ),
    });
  }, [editorFontFamily, editorFontSize, editorLineHeight, resolvedTheme]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: editable.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: hint.reconfigure(placeholder ? editorPlaceholder(placeholder) : []),
    });
  }, [placeholder]);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-input bg-transparent py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <div ref={containerRef} className="relative size-full" />
    </div>
  );
}
