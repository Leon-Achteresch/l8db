import { useCallback } from "react";
import { toast } from "sonner";

import { validateSql } from "@/lib/db";
import { resolveQueryRunTarget } from "@/lib/query-run-target";
import { locateText } from "@/lib/sql-diagnostics";
import { statementAtOffset } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";

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
  setEditorFocus: (focus: boolean) => void;
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
  setEditorFocus,
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
    const statement = statementAtOffset(sql, cursorOffset, connection?.kind);
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
    setStatementRange,
    setStatementError,
  ]);

  const handleCheck = useCallback(async () => {
    const target = resolveQueryRunTarget(
      sql,
      selectedSql,
      cursorOffset,
      workspace.runTarget,
      connection?.kind,
    );
    if (!connection || !target.trim() || isChecking) return;
    setIsChecking(true);
    setStatementError(null);
    try {
      await validateSql(
        connection.kind,
        effectiveConnectionString(connection),
        target,
        database ?? undefined,
      );
      setError(null);
      setErrorSource(null);
      toast.success("Fehlerfrei geprüft — nichts wurde übernommen.");
    } catch (err) {
      const message = String(err);
      setError(message);
      const base = locateText(editorSqlRef.current, target, cursorOffsetRef.current);
      setErrorSource(base === null ? null : { text: target, base });
    } finally {
      setIsChecking(false);
    }
  }, [
    connection,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    database,
    isChecking,
    setIsChecking,
    setStatementError,
    setError,
    setErrorSource,
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
    );
    if (!connection || !target.trim() || exec.runningRef.current) return;
    setStatementError(null);
    if (await previewSql(target)) await runSql(target, undefined, false, true);
  }, [
    connection,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    exec.runningRef,
    previewSql,
    runSql,
    setStatementError,
  ]);

  return { handleRun, handleRunSelection, handleRunStatement, handleCheck, handlePreview };
}

export type RunActions = ReturnType<typeof useRunActions>;
