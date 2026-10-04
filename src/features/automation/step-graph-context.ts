import type { KeyboardEvent } from "react";
import { createContext, useContext } from "react";
import type { GraphInsert } from "@/lib/automation/step-graph";
import type { ActionType } from "@/lib/db/automation";

export interface StepGraphActions {
  select: (id: string) => void;
  focus: (id: string) => void;
  keyDown: (id: string, event: KeyboardEvent<HTMLElement>) => void;
  insert: (insert: GraphInsert, type: ActionType) => void;
  disconnect: (edgeId: string) => void;
}

export const StepGraphContext = createContext<StepGraphActions | null>(null);

export function useStepGraph(): StepGraphActions {
  const value = useContext(StepGraphContext);
  if (!value) throw new Error("StepGraphContext fehlt.");
  return value;
}
