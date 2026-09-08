import type { EditorPosition } from "@/features/query/query-editor-pane";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

interface QueryEditorStatusbarProps {
  position: EditorPosition;
  selectionLength: number;
  statementCount: number;
  dialectLabel: string;
}

export function QueryEditorStatusbar({
  position,
  selectionLength,
  statementCount,
  dialectLabel,
}: QueryEditorStatusbarProps) {
  const insertSpaces = useQueryWorkspace((s) => s.insertSpaces);
  const editorTabSize = useSettingsStore((s) => s.editorTabSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const setEditorWordWrap = useSettingsStore((s) => s.setEditorWordWrap);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-t bg-muted/40 px-3 text-[11px] text-muted-foreground select-none">
      <span className="font-mono whitespace-nowrap tabular-nums">
        Ze {position.line}, Sp {position.column}
      </span>
      {selectionLength > 0 && (
        <span className="whitespace-nowrap tabular-nums">
          ({selectionLength} Zeichen ausgewählt)
        </span>
      )}
      <span className="mx-1 h-3 w-px shrink-0 bg-border" />
      <span className="whitespace-nowrap tabular-nums">
        {statementCount} Statement{statementCount === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span className="hidden whitespace-nowrap sm:inline">{dialectLabel}</span>
        <span className="hidden h-3 w-px bg-border sm:inline-block" />
        <span className="whitespace-nowrap tabular-nums">
          {insertSpaces ? "Leerzeichen" : "Tabulatoren"}: {editorTabSize}
        </span>
        <span className="h-3 w-px bg-border" />
        <button
          type="button"
          onClick={() => setEditorWordWrap(!editorWordWrap)}
          title="Zeilenumbruch umschalten"
          className={cn(
            "rounded px-1.5 py-0.5 whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground",
            editorWordWrap && "text-foreground",
          )}
        >
          Umbruch: {editorWordWrap ? "An" : "Aus"}
        </button>
        <span className="h-3 w-px bg-border" />
        <span className="whitespace-nowrap">UTF-8</span>
      </div>
    </div>
  );
}
