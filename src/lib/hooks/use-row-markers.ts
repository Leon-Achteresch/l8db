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
    const available = new Set(rows.map(keyOf));
    keys =
      state.scope !== scope
        ? new Set()
        : new Set([...state.keys].filter((key) => available.has(key)));
    setState({ rows, scope, keys });
  }
  const markedRows = useMemo(
    () => new Set(rows.filter((row) => keys.has(keyOf(row)))),
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
