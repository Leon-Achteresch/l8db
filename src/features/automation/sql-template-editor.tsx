import { TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { unsafeSqlPlaceholders } from "@/lib/automation/placeholders";
import { monaco, overflowWidgetsDomNode } from "@/lib/monaco";
import { cn } from "@/lib/utils";
import { useStepForm } from "./step-form-context";

const MIN_HEIGHT = 112;
const MAX_HEIGHT = 360;

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function SqlTemplateEditor({
  value,
  onChange,
  placeholder,
  label,
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: Props) {
  const { suggestions, items } = useStepForm();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const suggestionsRef = useRef(suggestions);
  onChangeRef.current = onChange;
  suggestionsRef.current = suggestions;
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "l8db-dark" : "l8db-light";
  const initial = useRef({ value, theme, placeholder, label });
  const unsafe = unsafeSqlPlaceholders(value, items);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, {
      value: initial.current.value,
      language: "sql",
      theme: initial.current.theme,
      placeholder: initial.current.placeholder,
      ariaLabel: initial.current.label,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 6,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode,
      quickSuggestions: { other: true, comments: false, strings: true },
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
      },
    });
    editorRef.current = editor;
    const model = editor.getModel();
    const completion = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: ["{", "."],
      provideCompletionItems: (target, position) => {
        if (target !== model) return { suggestions: [] };
        const before = target.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const match = /\$\{([A-Za-z0-9_.:+-]*)$/.exec(before);
        if (!match) return { suggestions: [] };
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - match[1].length,
          endColumn: position.column,
        };
        return {
          suggestions: suggestionsRef.current.map((entry, index) => ({
            label: entry.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: entry.example,
            documentation: entry.description,
            insertText: `${entry.name}}`,
            sortText: String(index).padStart(4, "0"),
            range,
          })),
        };
      },
    });
    const resize = () => {
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, editor.getContentHeight()));
      container.style.height = `${height}px`;
      editor.layout();
    };
    resize();
    const size = editor.onDidContentSizeChange(resize);
    const change = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    return () => {
      size.dispose();
      change.dispose();
      completion.dispose();
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

  return (
    <div className="flex flex-col gap-1.5">
      <div
        id={id}
        aria-describedby={describedBy}
        className={cn(
          "overflow-hidden rounded-lg border border-input transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          invalid && "border-destructive",
        )}
      >
        <div ref={containerRef} className="w-full" />
      </div>
      {unsafe.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Wert wird ungeprüft eingesetzt. Nutze <code className="font-mono">|sql</code> in
            String-Literalen:{" "}
            <span className="font-mono">{unsafe.map((name) => `\${${name}}`).join(", ")}</span>
          </span>
        </p>
      )}
    </div>
  );
}
