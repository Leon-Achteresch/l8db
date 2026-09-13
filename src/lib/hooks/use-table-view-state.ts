import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import { type TableViewState, useTableViewStateStore } from "@/lib/table-view-state";

export function useTableViewState<K extends keyof TableViewState>(
  key: string | undefined,
  field: K,
  initial: TableViewState[K] | (() => TableViewState[K]),
): [TableViewState[K], Dispatch<SetStateAction<TableViewState[K]>>] {
  const [fallback, setFallback] = useState(initial);
  const saved = useTableViewStateStore((state) => (key ? state.views[key]?.[field] : undefined));
  const setValue = useCallback<Dispatch<SetStateAction<TableViewState[K]>>>(
    (update) => {
      if (!key) {
        setFallback(update);
        return;
      }
      const store = useTableViewStateStore.getState();
      const current = store.views[key]?.[field] ?? fallback;
      const value = typeof update === "function" ? update(current) : update;
      if (store.views[key]?.[field] === undefined || !Object.is(current, value)) {
        store.patch(key, { [field]: value });
      }
    },
    [key, field, fallback],
  );
  return [saved ?? fallback, setValue];
}
