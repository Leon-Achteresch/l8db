import { createContext, useContext } from "react";

export type WorkspacePaneValue = {
  index: number;
  focused: boolean;
};

export const WorkspacePaneContext = createContext<WorkspacePaneValue | null>(null);

export function useWorkspacePane(): WorkspacePaneValue | null {
  return useContext(WorkspacePaneContext);
}
