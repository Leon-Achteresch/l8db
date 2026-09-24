import { useCallback, useMemo, useState } from "react";
import { stableMarkerKey } from "@/lib/row-markers";

export function useRowMarkers<T>(rows: T[], scope?: string, primaryKeys: string[] = []) {
  const [state, setState] = useState<{ rows: T[]; scope?: string; keys: Set<string | T> }>(() => ({
    rows,
    scope,
    keys: new Set(),
  }));
  const keyOf = useCallback((row: T) => stableMarkerKey(row, primaryKeys) ?? row, [primaryKeys]);
  let keys = state.keys;
  if (state.rows !== rows || state.scope !== scope) {
    if (state.scope !== scope || state.keys.size === 0) keys = new Set();
    else {
      const available = new Set(rows.map(keyOf));
      keys = new Set([...state.keys].filter((key) => available.has(key)));
    }
    setState({ rows, scope, keys });
  }
  const markedRows = useMemo(
    () => (keys.size ? new Set(rows.filter((row) => keys.has(keyOf(row)))) : new Set<T>()),
    [rows, keys, keyOf],
  );

  const toggleRowMarker = useCallback(
    (row: T) => {
      setState((previous) => {
        const next = new Set(previous.keys);
        const key = keyOf(row);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...previous, keys: next };
      });
    },
    [keyOf],
  );

  const hasEphemeralMarkers = [...markedRows].some(
    (row) => stableMarkerKey(row, primaryKeys) === undefined,
  );
  return { markedRows, toggleRowMarker, hasEphemeralMarkers };
}
