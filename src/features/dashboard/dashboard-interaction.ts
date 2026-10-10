import { createContext, useContext } from "react";

export interface DashboardInteraction {
  dashboardId: string;
  presenting: boolean;
  goToPage: (pageId: string) => void;
}

export const DashboardInteractionContext = createContext<DashboardInteraction | null>(null);

export function useDashboardInteraction(): DashboardInteraction | null {
  return useContext(DashboardInteractionContext);
}
