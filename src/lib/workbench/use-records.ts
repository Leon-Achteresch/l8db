import { useEffect, useState } from "react";
import {
  listWorkbenchRecords,
  type RecordKind,
  subscribeWorkbench,
  type WorkbenchRecord,
} from "./records";

export function useWorkbenchRecords<T>(kind: RecordKind, scope: string, enabled = true) {
  const [state, setState] = useState<{
    kind: RecordKind;
    scope: string;
    records: WorkbenchRecord<T>[];
    loading: boolean;
    error: string | null;
  }>({ kind, scope, records: [], loading: true, error: null });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      void listWorkbenchRecords<T>(kind, scope)
        .then((records) => {
          if (!disposed && generation === current)
            setState({ kind, scope, records, loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (!disposed && generation === current)
            setState({ kind, scope, records: [], loading: false, error: String(error) });
        });
    };
    const unsubscribe = subscribeWorkbench((change) => {
      if (!change || (change.kind === kind && change.scope === scope)) refresh();
    });
    refresh();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [kind, scope, enabled]);
  if (!enabled) return { records: [], loading: false, error: null };
  return state.kind === kind && state.scope === scope
    ? state
    : { records: [], loading: true, error: null };
}
