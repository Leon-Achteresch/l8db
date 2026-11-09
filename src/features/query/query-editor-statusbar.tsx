import { useDeferredValue, useMemo, useSyncExternalStore } from "react";

import { EditorAiCheckpoints } from "@/features/query/editor-ai/editor-ai-checkpoints";
import type { EditorPositionStore } from "@/features/query/query-view/editor-position-store";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useSettingsStore } from "@/lib/settings";
import { splitSqlStatements } from "@/lib/sql-statements";
import { cn } from "@/lib/utils";

interface QueryEditorStatusbarProps {
  positionStore: EditorPositionStore;
  selectionLength: number;
  sql: string;
  dialect: string | undefined;
  dialectLabel: string;
  editorId?: string;
}

export function QueryEditorStatusbar({
  positionStore,
  selectionLength,
  sql,
  dialect,
  dialectLabel,
  editorId,
}: QueryEditorStatusbarProps) {
  const deferredSql = useDeferredValue(sql);
  const statementCount = useMemo(
    () => splitSqlStatements(deferredSql, dialect).statements.length,
    [deferredSql, dialect],
  );
  const position = useSyncExternalStore(positionStore.subscribe, positionStore.get);
  const insertSpaces = useQueryWorkspace((s) => s.insertSpaces);
  const editorTabSize = useSettingsStore((s) => s.editorTabSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const setEditorWordWrap = useSettingsStore((s) => s.setEditorWordWrap);

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto bg-muted/40 px-3 text-[11px] text-muted-foreground select-none">
      <span className="font-mono whitespace-nowrap tabular-nums">
        Ze {position.line}, Sp {position.column}
      </span>
      {selectionLength > 0 && (
        <span className="whitespace-nowrap text-foreground tabular-nums">
          {selectionLength} ausgewählt
        </span>
      )}
      <span className="whitespace-nowrap tabular-nums">
        {statementCount} Statement{statementCount === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {editorId && <EditorAiCheckpoints editorId={editorId} />}
        <span className="hidden whitespace-nowrap sm:inline">{dialectLabel}</span>
        <span className="whitespace-nowrap tabular-nums">
          {insertSpaces ? "Leerzeichen" : "Tabulatoren"} {editorTabSize}
        </span>
        <button
          type="button"
          aria-pressed={editorWordWrap}
          onClick={() => setEditorWordWrap(!editorWordWrap)}
          title="Zeilenumbruch umschalten"
          className={cn(
            "-mx-1.5 flex cursor-pointer items-center gap-1.5 rounded-full px-1.5 py-0.5 whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground",
            editorWordWrap && "text-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              editorWordWrap ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          Umbruch
        </button>
        <span className="whitespace-nowrap">UTF-8</span>
      </div>
    </div>
  );
}
