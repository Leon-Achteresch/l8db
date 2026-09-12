import { useCallback, useState } from "react";

export function useRowMarkers<T>(rows: T[]) {
  const [source, setSource] = useState(rows);
  const [markedRows, setMarkedRows] = useState<Set<T>>(() => new Set());

  if (source !== rows) {
    setSource(rows);
    setMarkedRows(new Set());
  }

  const toggleRowMarker = useCallback((row: T) => {
    setMarkedRows((previous) => {
      const next = new Set(previous);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  }, []);

  return { markedRows, toggleRowMarker };
}
