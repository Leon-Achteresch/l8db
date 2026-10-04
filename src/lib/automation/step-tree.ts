import type { Step } from "@/lib/db/automation";

export interface FlatStep {
  step: Step;
  depth: number;
  parentId: string | null;
  index: number;
  number: string;
  siblings: Step[];
}

export function flattenSteps(
  steps: Step[],
  parentId: string | null = null,
  prefix = "",
  depth = 0,
): FlatStep[] {
  return steps.flatMap((step, index) => {
    const number = `${prefix}${index + 1}`;
    const entry: FlatStep = { step, depth, parentId, index, number, siblings: steps };
    if (step.action.type !== "loop") return [entry];
    return [entry, ...flattenSteps(step.action.steps, step.id, `${number}.`, depth + 1)];
  });
}

export function findStep(steps: Step[], id: string): FlatStep | null {
  return flattenSteps(steps).find((entry) => entry.step.id === id) ?? null;
}

export function mapLevel(
  steps: Step[],
  parentId: string | null,
  change: (level: Step[]) => Step[],
): Step[] {
  if (parentId === null) return change(steps);
  return steps.map((step) => {
    if (step.action.type !== "loop") return step;
    const nested =
      step.id === parentId
        ? change(step.action.steps)
        : mapLevel(step.action.steps, parentId, change);
    return nested === step.action.steps
      ? step
      : { ...step, action: { ...step.action, steps: nested } };
  });
}

export function updateStep(steps: Step[], id: string, update: (step: Step) => Step): Step[] {
  return steps.map((step) => {
    if (step.id === id) return update(step);
    if (step.action.type !== "loop") return step;
    const nested = updateStep(step.action.steps, id, update);
    return { ...step, action: { ...step.action, steps: nested } };
  });
}

export function removeStep(steps: Step[], id: string): Step[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.action.type === "loop"
        ? { ...step, action: { ...step.action, steps: removeStep(step.action.steps, id) } }
        : step,
    );
}

export function insertStep(
  steps: Step[],
  parentId: string | null,
  index: number,
  step: Step,
): Step[] {
  return mapLevel(steps, parentId, (level) => {
    const next = [...level];
    next.splice(Math.max(0, Math.min(index, level.length)), 0, step);
    return next;
  });
}

export function moveStep(steps: Step[], parentId: string | null, from: number, to: number): Step[] {
  return mapLevel(steps, parentId, (level) => {
    if (from === to || to < 0 || to >= level.length) return level;
    const next = [...level];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}

export function stepLabel(steps: Step[], id: string): string {
  const found = findStep(steps, id);
  return found ? `${found.number} ${found.step.name}` : "unbekannter Schritt";
}
