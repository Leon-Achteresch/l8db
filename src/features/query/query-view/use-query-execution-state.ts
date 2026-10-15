import { useHotkey } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { QueryResult } from "@/lib/db";
import { onHotkeyAction, useResolvedHotkey } from "@/lib/hotkeys";
import {
  queryTabScope,
  readTabState,
  tabStateKey,
  useTabState,
  writeTabState,
} from "@/lib/tab-state";
import { cancelTask, useTasksStore } from "@/lib/tasks";

export function useQueryExecutionState(tabId: string) {
  const scope = queryTabScope(tabId);
  const key = (field: string) => tabStateKey(scope, field);
  const [result, setResultState] = useTabState<QueryResult | null>(key("result"), null);
  const [error, setError] = useTabState<string | null>(key("error"), null);
  const [executedSql, setExecutedSql] = useTabState(key("executedSql"), "");
  const [viewSource, setViewSource] = useTabState<{ text: string; runId: string } | null>(
    key("viewSource"),
    null,
  );
  const [errorSource, setErrorSource] = useTabState<{ text: string; base: number } | null>(
    key("errorSource"),
    null,
  );
  const [isRunning, setIsRunning] = useTabState(key("running"), false);
  const [isChecking, setIsChecking] = useState(false);
  const [activeJobId, setActiveJobId] = useTabState<string | null>(key("activeJobId"), null);
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
  const runningKey = key("running");
  const runningRef = useMemo(
    () => ({
      get current() {
        return readTabState<boolean>(runningKey) ?? false;
      },
      set current(value: boolean) {
        writeTabState(runningKey, value);
      },
    }),
    [runningKey],
  );
  const editorError = useMemo(
    () => (error && errorSource ? { message: error, ...errorSource } : null),
    [error, errorSource],
  );
  const [statementRange, setStatementRange] = useState<{ start: number; end: number } | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [scriptEntries, setScriptEntries] = useTabState<ScriptRunEntry[] | null>(
    key("scriptEntries"),
    null,
  );
  const [scriptActiveIndex, setScriptActiveIndex] = useTabState<number | null>(
    key("scriptActiveIndex"),
    null,
  );
  const [scriptNote, setScriptNote] = useTabState(key("scriptNote"), "");

  return {
    scope,
    result,
    setResultState,
    executedSql,
    setExecutedSql,
    viewSource,
    setViewSource,
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
