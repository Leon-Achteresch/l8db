import { useCallback } from "react";

import { resolveQueryRunTarget } from "@/lib/query-run-target";
import { useSettingsStore } from "@/lib/settings";
import { locateText } from "@/lib/sql-diagnostics";
import { statementAtOffset } from "@/lib/sql-statements";

import { checkSql } from "./check-sql";
import type { QueryViewConnection, QueryWorkspaceState } from "./types";
import type { EditorCursorState } from "./use-editor-cursor-state";
import type { QueryExecutionState } from "./use-query-execution-state";

interface UseRunActionsParams {
  sql: string;
  connection: QueryViewConnection;
  database: string | null;
  workspace: QueryWorkspaceState;
  exec: QueryExecutionState;
  cursor: EditorCursorState;
  runSql: (
    text: string,
    bound?: undefined,
    skipBind?: boolean,
    previewed?: boolean,
  ) => Promise<void>;
  previewSql: (text: string) => Promise<boolean>;
  prepareSql: (text: string) => Promise<string | null>;
  setEditorFocus: (focus: boolean) => void;
  setOutputOpen: (open: boolean) => void;
}

export function useRunActions({
  sql,
  connection,
  database,
  workspace,
  exec,
  cursor,
  runSql,
  previewSql,
  prepareSql,
  setEditorFocus,
  setOutputOpen,
}: UseRunActionsParams) {
  const { selectedSql, cursorOffset, editorSqlRef, cursorOffsetRef } = cursor;
  const {
    setStatementRange,
    setStatementError,
    isChecking,
    setIsChecking,
    setError,
    setErrorSource,
  } = exec;
  const blankLines = useSettingsStore((state) => state.editorBlankLineTerminator);

  const handleRun = useCallback(() => {
    setEditorFocus(false);
    setStatementRange(null);
    setStatementError(null);
    const target = resolveQueryRunTarget(
      sql,
      selectedSql,
      cursorOffset,
      workspace.runTarget,
      connection?.kind,
      { blankLines },
    );
    if (!target.trim()) {
      setStatementError("Kein ausführbares Statement an der Cursorposition.");
      return;
    }
    void runSql(target);
  }, [
    runSql,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    blankLines,
    connection?.kind,
    setEditorFocus,
    setStatementRange,
    setStatementError,
  ]);

  const handleRunSelection = useCallback(() => {
    if (!selectedSql.trim()) return;
    setStatementRange(null);
    setStatementError(null);
    void runSql(selectedSql);
  }, [runSql, selectedSql, setStatementRange, setStatementError]);

  const handleRunStatement = useCallback(() => {
    if (selectedSql.trim()) {
      handleRunSelection();
      return;
    }
    const statement = statementAtOffset(sql, cursorOffset, connection?.kind, { blankLines });
    if (!statement) {
      setStatementRange(null);
      setStatementError(
        "Statement unter dem Cursor konnte nicht eindeutig bestimmt werden. Bitte den gewünschten Bereich markieren.",
      );
      return;
    }
    setStatementError(null);
    setStatementRange({ start: statement.start, end: statement.end });
    void runSql(statement.text);
  }, [
    cursorOffset,
    handleRunSelection,
    runSql,
    selectedSql,
    sql,
    connection?.kind,
    blankLines,
    setStatementRange,
    setStatementError,
  ]);

  const handleCheck = useCallback(async () => {
    if (isChecking) return;
    setIsChecking(true);
    setStatementError(null);
    try {
      const outcome = await checkSql({
        sql,
        selectedSql,
        cursorOffset,
        runTarget: workspace.runTarget,
        blankLines,
        connection,
        database,
      });
      if (outcome.status === "skipped") return;
      if (outcome.status === "ok") {
        setError(null);
        setErrorSource(null);
        return;
      }
      setEditorFocus(false);
      setOutputOpen(false);
      setError(outcome.message);
      const base = locateText(editorSqlRef.current, outcome.target, cursorOffsetRef.current);
      setErrorSource(base === null ? null : { text: outcome.target, base });
    } finally {
      setIsChecking(false);
    }
  }, [
    connection,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    blankLines,
    database,
    isChecking,
    setIsChecking,
    setStatementError,
    setError,
    setErrorSource,
    setEditorFocus,
    setOutputOpen,
    editorSqlRef,
    cursorOffsetRef,
  ]);

  const handlePreview = useCallback(async () => {
    const target = resolveQueryRunTarget(
      sql,
      selectedSql,
      cursorOffset,
      workspace.runTarget,
      connection?.kind,
      { blankLines },
    );
    if (!connection || !target.trim() || exec.runningRef.current) return;
    setStatementError(null);
    const prepared = await prepareSql(target);
    if (prepared === null) return;
    if (await previewSql(prepared)) await runSql(prepared, undefined, false, true);
  }, [
    connection,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    blankLines,
    exec.runningRef,
    previewSql,
    prepareSql,
    runSql,
    setStatementError,
  ]);

  return { handleRun, handleRunSelection, handleRunStatement, handleCheck, handlePreview };
}

export type RunActions = ReturnType<typeof useRunActions>;
