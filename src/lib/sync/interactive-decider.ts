import type { SyncDecider, SyncDecision } from "./engine";
import type { ConflictStrategy, SyncConflict } from "./merge";

type Preview = Extract<SyncDecision, { kind: "preview" }>;

export interface InteractiveDecider {
  decider: SyncDecider;
  resolveConflicts(strategy: ConflictStrategy | null): void;
  resolvePreview(accepted: boolean): void;
  dispose(): void;
}

export function createInteractiveDecider(show: {
  conflicts(list: SyncConflict[] | null): void;
  preview(decision: Preview | null): void;
}): InteractiveDecider {
  let conflicts: ((strategy: ConflictStrategy | null) => void) | null = null;
  let preview: ((accepted: boolean) => void) | null = null;
  let disposed = false;
  const resolveConflicts = (strategy: ConflictStrategy | null) => {
    const resolve = conflicts;
    conflicts = null;
    if (!disposed) show.conflicts(null);
    resolve?.(strategy);
  };
  const resolvePreview = (accepted: boolean) => {
    const resolve = preview;
    preview = null;
    if (!disposed) show.preview(null);
    resolve?.(accepted);
  };
  return {
    decider: {
      conflicts: (list) =>
        disposed
          ? Promise.resolve(null)
          : new Promise((resolve) => {
              conflicts = resolve;
              show.conflicts(list);
            }),
      preview: (decision) =>
        disposed
          ? Promise.resolve(false)
          : new Promise((resolve) => {
              preview = resolve;
              show.preview(decision);
            }),
    },
    resolveConflicts,
    resolvePreview,
    dispose: () => {
      disposed = true;
      resolveConflicts(null);
      resolvePreview(false);
    },
  };
}
