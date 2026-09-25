import { useHotkey } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { QueryResult } from "@/lib/db";
import { onHotkeyAction, useResolvedHotkey } from "@/lib/hotkeys";
import { cancelTask, useTasksStore } from "@/lib/tasks";

export function useQueryExecutionState() {
  const [result, setResultState] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executedSql, setExecutedSql] = useState("");
  const [errorSource, setErrorSource] = useState<{ text: string; base: number } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJob = useTasksStore((state) => state.tasks.find((task) => task.id === activeJobId));
  const stopActiveJob = useCallback(() => {
    if (activeJobId) void cancelTask(activeJobId).catch((failure) => toast.error(String(failure)));
  }, [activeJobId]);
  useEffect(() => onHotkeyAction("query.cancel", stopActiveJob), [stopActiveJob]);
  const cancelHotkey = useResolvedHotkey("query.cancel");
  useHotkey(cancelHotkey, stopActiveJob, {
    enabled: Boolean(activeJob?.cancellable),
    ignoreInputs: false,
  });
  const runningRef = useRef(false);
  const editorError = useMemo(
    () => (error && errorSource ? { message: error, ...errorSource } : null),
    [error, errorSource],
  );
  const [statementRange, setStatementRange] = useState<{ start: number; end: number } | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [scriptEntries, setScriptEntries] = useState<ScriptRunEntry[] | null>(null);
  const [scriptActiveIndex, setScriptActiveIndex] = useState<number | null>(null);
  const [scriptNote, setScriptNote] = useState("");

  return {
    result,
    setResultState,
    executedSql,
    setExecutedSql,
    error,
    setError,
    setErrorSource,
    isRunning,
    setIsRunning,
    isChecking,
    setIsChecking,
    setActiveJobId,
    activeJob,
    stopActiveJob,
    runningRef,
    editorError,
    statementRange,
    setStatementRange,
    statementError,
    setStatementError,
    scriptEntries,
    setScriptEntries,
    scriptActiveIndex,
    setScriptActiveIndex,
    scriptNote,
    setScriptNote,
  };
}

export type QueryExecutionState = ReturnType<typeof useQueryExecutionState>;
