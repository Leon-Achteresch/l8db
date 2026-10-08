import { createContext, useContext } from "react";
import type { Period } from "@/lib/dashboards";

export const DashboardPeriodContext = createContext<Period | null>(null);

export function useDashboardPeriod(): Period | null {
  return useContext(DashboardPeriodContext);
}
