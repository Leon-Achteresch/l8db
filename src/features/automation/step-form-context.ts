import { createContext, useContext } from "react";
import type { PlaceholderInfo } from "@/lib/automation/placeholders";
import type {
  Action,
  ActionType,
  AutomationSettings,
  Step,
  Task,
  TaskSummary,
  ValidationIssue,
} from "@/lib/db/automation";

export interface StepFormContextValue {
  task: Task;
  stepId: string | null;
  issues: ValidationIssue[];
  suggestions: PlaceholderInfo[];
  items: string[];
  siblings: Step[];
  settings: AutomationSettings | null;
  tasks: TaskSummary[];
}

export const StepFormContext = createContext<StepFormContextValue | null>(null);

export function useStepForm(): StepFormContextValue {
  const value = useContext(StepFormContext);
  if (!value) throw new Error("StepFormContext fehlt.");
  return value;
}

export function useFieldError(field: string): string | null {
  const { issues, stepId } = useStepForm();
  const issue = issues.find(
    (entry) => entry.stepId === stepId && entry.field === field && entry.severity === "error",
  );
  return issue?.message ?? null;
}

export function useFieldWarning(field: string): string | null {
  const { issues, stepId } = useStepForm();
  return (
    issues.find(
      (entry) => entry.stepId === stepId && entry.field === field && entry.severity === "warning",
    )?.message ?? null
  );
}

export function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalText(value: string): string | null {
  return value.trim() ? value : null;
}

export interface StepFormProps<T extends ActionType> {
  action: Extract<Action, { type: T }>;
  onChange: (action: Extract<Action, { type: T }>) => void;
}
