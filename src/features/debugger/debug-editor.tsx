import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { themeFor } from "@/features/functions/function-view/theme-for";
import { monaco } from "@/lib/monaco";

interface DebugEditorProps {
  source: string;
  line?: number;
  breakpoints: number[];
  enabled: boolean;
  onChange?: (value: string) => void;
  onToggle: (line: number) => void;
}

export function DebugEditor({
  source,
  line,
  breakpoints,
  enabled,
  onToggle,
  onChange,
}: DebugEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const toggle = useRef(onToggle);
  const active = useRef(enabled);
  const change = useRef(onChange);
  change.current = onChange;
  const { resolvedTheme } = useTheme();
  toggle.current = onToggle;
  active.current = enabled;

  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      value: "",
      language: "plsql",

      readOnly: true,
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 24,
      padding: { top: 20, bottom: 20 },
      renderLineHighlight: "gutter",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      scrollBeyondLastLine: false,
    });
    editor.current = instance;
    const click = instance.onMouseDown((event) => {
      if (
        active.current &&
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.position
      )
        toggle.current(event.target.position.lineNumber);
    });
    const content = instance.onDidChangeModelContent(() => change.current?.(instance.getValue()));
    return () => {
      content.dispose();
      click.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    editor.current?.updateOptions({
      readOnly: !onChange,
      glyphMargin: !onChange,
      ariaLabel: onChange ? "Aufrufskript" : "Debugger-Quelltext",
    });
  }, [onChange]);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    if (instance.getValue() !== source) instance.setValue(source);
    const decorations = instance.createDecorationsCollection([
      ...breakpoints.map((number) => ({
        range: new monaco.Range(number, 1, number, 1),
        options: {
          glyphMarginClassName: "debug-breakpoint",
          glyphMarginHoverMessage: { value: "Breakpoint entfernen" },
        },
      })),
      ...(line && line > 0
        ? [
            {
              range: new monaco.Range(line, 1, line, 1),
              options: { isWholeLine: true, className: "debug-current-line" },
            },
          ]
        : []),
    ]);
    if (line && line > 0) instance.revealLineInCenterIfOutsideViewport(line);
    return () => decorations.clear();
  }, [source, line, breakpoints]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  return (
    <section ref={container} className="min-h-0 min-w-0 flex-1" aria-label="Debugger-Quelltext" />
  );
}
