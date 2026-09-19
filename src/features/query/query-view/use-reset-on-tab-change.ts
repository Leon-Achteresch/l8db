import { useEffect } from "react";

import type { EditorCursorState } from "./use-editor-cursor-state";
import type { QueryExecutionState } from "./use-query-execution-state";

export function useResetOnTabChange(
  tabId: string,
  cursor: EditorCursorState,
  exec: QueryExecutionState,
) {
  const { setSelectedSql, setCursorOffset, setCursorPosition } = cursor;
  const { setStatementRange, setStatementError, setScriptEntries, setScriptActiveIndex } = exec;
  useEffect(() => {
    setSelectedSql("");
    setCursorOffset(0);
    setCursorPosition({ line: 1, column: 1, offset: 0 });
    setStatementRange(null);
    setStatementError(null);
    setScriptEntries(null);
    setScriptActiveIndex(null);
  }, [
    tabId,
    setSelectedSql,
    setCursorOffset,
    setCursorPosition,
    setStatementRange,
    setStatementError,
    setScriptEntries,
    setScriptActiveIndex,
  ]);
}
