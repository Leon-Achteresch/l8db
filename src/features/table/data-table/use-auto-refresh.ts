import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AutoRefreshConditions,
  autoRefreshPauseReason,
  shouldAutoRefresh,
  useAutoRefreshStore,
} from "@/lib/auto-refresh";
import { useTransactionStore } from "@/lib/transactions";
import type { EditingCell, FkPickerCell, InspectCell } from "../data-table-types";

type Options = {
  stateKey: string | undefined;
  connection: { id: string } | null | undefined;
  onRefresh: (() => void | Promise<void>) | undefined;
  hasDraft: boolean;
  editingCell: EditingCell | null;
  inspectCell: InspectCell | null;
  fkPickerCell: FkPickerCell | null;
  isSaving: boolean;
  isFetching: boolean;
};

export function useAutoRefresh({
  stateKey,
  connection,
  onRefresh,
  hasDraft,
  editingCell,
  inspectCell,
  fkPickerCell,
  isSaving,
  isFetching,
}: Options) {
  const [localMs, setLocalMs] = useState(0);
  const storedMs = useAutoRefreshStore((state) => (stateKey ? state.intervals[stateKey] : 0));
  const autoRefreshMs = stateKey ? (storedMs ?? 0) : localMs;
  const setAutoRefreshMs = useCallback(
    (ms: number) => {
      if (stateKey) useAutoRefreshStore.getState().setIntervalMs(stateKey, ms);
      else setLocalMs(ms);
    },
    [stateKey],
  );
  const [isWindowVisible, setIsWindowVisible] = useState(true);

  const hasOpenTransaction = useTransactionStore((state) =>
    connection ? state.transactions.some((tx) => tx.connectionId === connection.id) : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsWindowVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const autoRefreshConditions = useMemo<AutoRefreshConditions>(
    () => ({
      intervalMs: autoRefreshMs,
      isTabVisible: true,
      isWindowVisible,
      isEditing: hasDraft || editingCell !== null || inspectCell !== null || fkPickerCell !== null,
      isSaving,
      isFetching,
      hasOpenTransaction,
    }),
    [
      autoRefreshMs,
      hasDraft,
      isWindowVisible,
      editingCell,
      inspectCell,
      fkPickerCell,
      isSaving,
      isFetching,
      hasOpenTransaction,
    ],
  );

  const autoRefreshRef = useRef(autoRefreshConditions);
  autoRefreshRef.current = autoRefreshConditions;
  const autoRefreshPause = autoRefreshPauseReason(autoRefreshConditions);

  useEffect(() => {
    if (!onRefresh || autoRefreshMs <= 0) return;
    const id = setInterval(() => {
      if (!shouldAutoRefresh(autoRefreshRef.current)) return;
      void Promise.resolve(onRefresh()).catch((err) => {
        toast.error(typeof err === "string" ? err : String(err));
      });
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [onRefresh, autoRefreshMs]);
  return { autoRefreshMs, setAutoRefreshMs, autoRefreshPause };
}
