import { createContext, useContext } from "react";
import { EMPTY_SCOPE, type VariableScope } from "@/lib/dashboards";

export const DashboardScopeContext = createContext<VariableScope>(EMPTY_SCOPE);

export function useDashboardScope(): VariableScope {
  return useContext(DashboardScopeContext);
}
