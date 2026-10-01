import { createContext, useContext } from "react";
import type { Tab } from "@/lib/table-tabs";

export const PaneTabTargetContext = createContext<{
  open: (tab: Tab) => void;
  current: Tab | null;
} | null>(null);

export function usePaneTabTarget() {
  return useContext(PaneTabTargetContext);
}
