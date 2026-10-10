import type { DmlPreviewPlan } from "./derive";
import {
  DmlPreviewCancelled,
  type DmlPreviewExecutor,
  type DmlPreviewOutcome,
  type DmlPreviewPhase,
  runDmlPreview,
} from "./run";

export interface PreviewSettlement {
  wait: boolean;
  decision: Promise<boolean>;
}

export function createPreviewLifecycle() {
  let tail: Promise<void> = Promise.resolve();
  let generation = 0;
  let disposed = false;
  const active = new Set<DmlPreviewExecutor>();

  const holding = () => [...active].some((executor) => executor.holdsSession?.() === true);

  return {
    current(): number {
      return generation;
    },
    next(): number {
      generation += 1;
      return generation;
    },
    start(
      plan: Pick<DmlPreviewPlan, "countSql" | "sampleSql" | "limit">,
      executor: DmlPreviewExecutor,
      options: { signal?: AbortSignal; onPhase?: (phase: DmlPreviewPhase) => void } = {},
    ): Promise<DmlPreviewOutcome> {
      active.add(executor);
      const result = tail.then(() => {
        if (options.signal?.aborted || disposed) throw new DmlPreviewCancelled();
        return runDmlPreview(plan, executor, options);
      });
      tail = result
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          active.delete(executor);
        });
      return result;
    },
    holding,
    settle(accepted: boolean): PreviewSettlement {
      const token = generation;
      if (!holding()) return { wait: false, decision: Promise.resolve(accepted && !disposed) };
      const pending = tail;
      return {
        wait: true,
        decision: pending.then(() => accepted && !disposed && token === generation),
      };
    },
    dispose(): void {
      disposed = true;
      generation += 1;
    },
    idle(): Promise<void> {
      return tail;
    },
  };
}

export type PreviewLifecycle = ReturnType<typeof createPreviewLifecycle>;

export function attachPreviewLifecycle(ref: { current: PreviewLifecycle | null }): () => void {
  const lifecycle = createPreviewLifecycle();
  ref.current = lifecycle;
  return () => {
    lifecycle.dispose();
    if (ref.current === lifecycle) ref.current = null;
  };
}
