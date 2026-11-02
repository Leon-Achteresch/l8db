import { createContext } from "react";
import type { WorkbenchRecord } from "./records";
import type { RowWatch, WatchedRowState } from "./row-watches";

export const RowWatchContext = createContext<{
  scope: string;
  records: WorkbenchRecord<RowWatch>[];
  states: WatchedRowState[];
  changedRows: Set<Record<string, unknown> | null>;
  loading: boolean;
  error: string | null;
}>({ scope: "", records: [], states: [], changedRows: new Set(), loading: false, error: null });
