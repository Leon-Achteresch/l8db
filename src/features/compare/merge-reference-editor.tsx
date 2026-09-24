import { ArrowDownIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { applyDefinitionHunk, type DefinitionHunk, definitionHunks } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";
import "./merge-reference-editor.css";

function hunkLine(hunk: DefinitionHunk, source: string): number {
  return Math.min(hunk.sourceStart + 1, source.split("\n").length);
}

interface Props {
  label: "Quelle" | "Ziel";
  source: string;
  draft: string;
  onlyDifferences: boolean;
  selected: boolean;
  onSelect: () => void;
  onDraftChange: (value: string) => void;
}

export function MergeReferenceEditor({
  label,
  source,
  draft,
  onlyDifferences,
  selected,
  onSelect,
  onDraftChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const { resolvedTheme } = useTheme();
  const hunks = useMemo(() => definitionHunks(source, draft), [source, draft]);
  const applyHunk = (hunk: DefinitionHunk) => {
    onSelect();
    onDraftChange(applyDefinitionHunk(source, draft, hunk));
  };
  const applyTitle = `Änderung aus ${label === "Quelle" ? "der Quelle" : "dem Ziel"} in den Entwurf übernehmen`;
  const applyAtLine = useRef((_line: number) => {});
  applyAtLine.current = (line) => {
    const hunk = hunks.find((item) => hunkLine(item, source) === line);
    if (hunk) applyHunk(hunk);
  };

  useEffect(() => {
    if (!container.current) return;
    const model = monaco.editor.createModel("", "sql");
    const instance = monaco.editor.create(container.current, {
      model,
      readOnly: true,
      theme: "l8db-light",
      automaticLayout: true,
      glyphMargin: true,
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
    const click = instance.onMouseDown((event) => {
      if (
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.position
      )
        applyAtLine.current(event.target.position.lineNumber);
    });
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    return () => {
      click.dispose();
      decorations.current?.clear();
      decorations.current = null;
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model && model.getValue() !== source) model.setValue(source);
    const nextDecorations = hunks.flatMap((hunk) => [
      {
        range: new monaco.Range(hunkLine(hunk, source), 1, hunkLine(hunk, source), 1),
        options: {
          glyphMarginClassName: "merge-hunk-apply codicon-arrow-down",
          glyphMarginHoverMessage: { value: applyTitle },
        },
      },
      ...(hunk.sourceEnd > hunk.sourceStart
        ? [
            {
              range: new monaco.Range(hunk.sourceStart + 1, 1, hunk.sourceEnd, 1),
              options: {
                isWholeLine: true,
                className: label === "Quelle" ? "merge-origin-source" : "merge-origin-target",
              },
            },
          ]
        : []),
    ]);
    decorations.current?.set(nextDecorations);
  }, [label, source, hunks, applyTitle]);

  useEffect(() => {
    if (editor.current)
      monaco.editor.setTheme(resolvedTheme === "dark" ? "l8db-dark" : "l8db-light");
  }, [resolvedTheme]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-xs">
        <button
          type="button"
          aria-label={`${label} auswählen`}
          aria-pressed={selected}
          className={`flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted ${selected ? "font-medium text-primary" : "text-muted-foreground"}`}
          onClick={onSelect}
        >
          <span
            className={`size-2 shrink-0 rounded-full ${selected ? "bg-primary" : "border border-muted-foreground"}`}
          />
          <span className="truncate">
            {label} ·{" "}
            {hunks.length === 0 ? "Entspricht dem Entwurf" : `${hunks.length} Abweichungen`}
          </span>
        </button>
      </div>
      <div
        ref={container}
        className={onlyDifferences ? "hidden" : "merge-reference-editor min-h-0 flex-1"}
      />
      {onlyDifferences && (
        <div className="min-h-0 flex-1 overflow-auto p-3 text-xs text-muted-foreground">
          {hunks.length === 0
            ? "Keine Unterschiede."
            : hunks.map((hunk) => (
                <div key={`${hunk.sourceStart}-${hunk.draftStart}`} className="mb-3 flex gap-1.5">
                  <Button
                    size="icon-sm"
                    className="size-6 shrink-0"
                    aria-label={applyTitle}
                    title={applyTitle}
                    onClick={() => applyHunk(hunk)}
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </Button>
                  <pre className="min-w-0 flex-1 overflow-auto rounded bg-muted/40 p-2 font-mono text-foreground">
                    {source.split("\n").slice(hunk.sourceStart, hunk.sourceEnd).join("\n") ||
                      "(Zeilen entfernen)"}
                  </pre>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
