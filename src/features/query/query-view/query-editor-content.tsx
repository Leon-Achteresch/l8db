import type { ComponentProps, RefObject } from "react";

import { type QueryEditorApi, QueryEditorPane } from "@/features/query/query-editor-pane";
import { QueryEditorStatusbar } from "@/features/query/query-editor-statusbar";

import type { QueryViewCapabilities } from "./types";
import type { EditorCursorState } from "./use-editor-cursor-state";
import type { QueryExecutionState } from "./use-query-execution-state";
import type { useQueryTabBookmarks } from "./use-query-tab-state";
import type { RunActions } from "./use-run-actions";

interface QueryEditorContentProps {
  tabId: string;
  sql: string;
  caps: QueryViewCapabilities;
  editorApiRef: RefObject<QueryEditorApi | null>;
  actions: RunActions;
  exec: QueryExecutionState;
  cursor: EditorCursorState;
  bookmarks: ReturnType<typeof useQueryTabBookmarks>;
  registry: ComponentProps<typeof QueryEditorPane>["registry"];
  statusVisible: boolean;
  statementCount: number;
  dialectLabel: string;
  onSqlChange: (tabId: string, sql: string) => void;
  onSave: () => void;
  onSearchTabs: () => void;
}

export function QueryEditorContent({
  tabId,
  sql,
  caps,
  editorApiRef,
  actions,
  exec,
  cursor,
  bookmarks,
  registry,
  statusVisible,
  statementCount,
  dialectLabel,
  onSqlChange,
  onSave,
  onSearchTabs,
}: QueryEditorContentProps) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden">
        <QueryEditorPane
          language={
            caps.query_language === "redis"
              ? "redis"
              : caps.query_language === "json"
                ? "json"
                : "sql"
          }
          ref={editorApiRef}
          value={sql}
          onChange={(v) => {
            exec.setStatementRange(null);
            exec.setStatementError(null);
            onSqlChange(tabId, v);
          }}
          onRun={actions.handleRun}
          onSave={onSave}
          onRunSelection={actions.handleRunSelection}
          onRunStatement={actions.handleRunStatement}
          onCheck={() => void actions.handleCheck()}
          onSelectionChange={cursor.setSelectedSql}
          onCursorChange={cursor.setCursorOffset}
          onPositionChange={cursor.setCursorPosition}
          highlight={exec.statementRange}
          error={exec.editorError}
          bookmarks={bookmarks.normalizedBookmarks}
          onBookmarksChange={(lines) => bookmarks.setQueryBookmarks(tabId, lines)}
          bookmarkSlots={bookmarks.bookmarkSlots}
          onBookmarkSlotChange={(slot, line) => bookmarks.setQueryBookmarkSlot(tabId, slot, line)}
          onSearchTabs={onSearchTabs}
          stateKey={tabId}
          registry={registry}
        />
      </div>

      {statusVisible && (
        <QueryEditorStatusbar
          position={cursor.cursorPosition}
          selectionLength={cursor.selectedSql.length}
          statementCount={statementCount}
          dialectLabel={dialectLabel}
        />
      )}
    </>
  );
}
