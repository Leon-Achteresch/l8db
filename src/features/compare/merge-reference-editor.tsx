import { ArrowDownIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { applyDefinitionHunk, definitionHunks } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";
import "./merge-reference-editor.css";

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

  useEffect(() => {
    if (!container.current) return;
    const model = monaco.editor.createModel("", "sql");
    const instance = monaco.editor.create(container.current, {
      model,
      readOnly: true,
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
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    return () => {
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
    const nextDecorations = hunks
      .filter((hunk) => hunk.sourceEnd > hunk.sourceStart)
      .map((hunk) => ({
        range: new monaco.Range(hunk.sourceStart + 1, 1, hunk.sourceEnd, 1),
        options: {
          isWholeLine: true,
          className: label === "Quelle" ? "merge-origin-source" : "merge-origin-target",
        },
      }));
    decorations.current?.set(nextDecorations);
  }, [label, source, hunks]);

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
      {hunks.length > 0 && (
        <div className="flex max-h-28 shrink-0 flex-wrap gap-1 overflow-auto border-b p-1.5">
          {hunks.map((hunk, index) => (
            <Button
              key={`${hunk.sourceStart}-${hunk.draftStart}`}
              size="sm"
              variant="outline"
              className="h-6 px-1.5 text-[11px]"
              title={`Änderung ${index + 1} aus der ${label} in den Entwurf übernehmen`}
              onClick={() => {
                onSelect();
                onDraftChange(applyDefinitionHunk(source, draft, hunk));
              }}
            >
              <ArrowDownIcon className="size-3" />
              Zeile {Math.min(hunk.sourceStart + 1, source.split("\n").length)}
            </Button>
          ))}
        </div>
      )}
      <div ref={container} className={onlyDifferences ? "hidden" : "min-h-0 flex-1"} />
      {onlyDifferences && (
        <div className="min-h-0 flex-1 overflow-auto p-3 text-xs text-muted-foreground">
          {hunks.length === 0
            ? "Keine Unterschiede."
            : hunks.map((hunk) => (
                <pre
                  key={`${hunk.sourceStart}-${hunk.draftStart}`}
                  className="mb-3 overflow-auto rounded bg-muted/40 p-2 font-mono text-foreground"
                >
                  {source.split("\n").slice(hunk.sourceStart, hunk.sourceEnd).join("\n") ||
                    "(Zeilen entfernen)"}
                </pre>
              ))}
        </div>
      )}
    </div>
  );
}
