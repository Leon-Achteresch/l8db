import type { SecretConflict, SecretResolutions, SyncDecider, SyncDecision } from "./engine";
import type { ConflictStrategy, SyncConflict } from "./merge";

type Preview = Extract<SyncDecision, { kind: "preview" }>;

export interface InteractiveDecider {
  decider: SyncDecider;
  resolveConflicts(strategy: ConflictStrategy | null): void;
  resolvePreview(accepted: boolean): void;
  resolveSecrets(resolutions: SecretResolutions | null): void;
  dispose(): void;
}

export function createInteractiveDecider(show: {
  conflicts(list: SyncConflict[] | null): void;
  preview(decision: Preview | null): void;
  secrets?(list: SecretConflict[] | null): void;
}): InteractiveDecider {
  let conflicts: ((strategy: ConflictStrategy | null) => void) | null = null;
  let preview: ((accepted: boolean) => void) | null = null;
  let secrets: ((resolutions: SecretResolutions | null) => void) | null = null;
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
  const resolveSecrets = (resolutions: SecretResolutions | null) => {
    const resolve = secrets;
    secrets = null;
    if (!disposed) show.secrets?.(null);
    resolve?.(resolutions);
  };
  return {
    decider: {
      secretConflicts: (list) =>
        disposed || !show.secrets
          ? Promise.resolve(null)
          : new Promise((resolve) => {
              secrets = resolve;
              show.secrets?.(list);
            }),
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
    resolveSecrets,
    dispose: () => {
      disposed = true;
      resolveConflicts(null);
      resolvePreview(false);
      resolveSecrets(null);
    },
  };
}
