import type { PerfRun } from "./types";

export interface PerfLoopOptions {
  repeats: number;
  concurrency: number;
  execute: (index: number) => Promise<PerfRun>;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface PerfLoopOutcome {
  runs: PerfRun[];
  elapsedMs: number;
  aborted: string | null;
  cancelled: boolean;
}

export async function runPerfLoop(options: PerfLoopOptions): Promise<PerfLoopOutcome> {
  const total = Math.max(1, Math.floor(options.repeats));
  const workers = Math.max(1, Math.min(Math.floor(options.concurrency), total));
  const runs: PerfRun[] = [];
  const state = { next: 1, successes: 0, aborted: null as string | null, cancelled: false };
  const started = performance.now();

  const worker = async () => {
    while (state.aborted === null) {
      if (options.isCancelled?.()) {
        state.cancelled = true;
        return;
      }
      const index = state.next;
      if (index > total) return;
      state.next += 1;
      const run = await options.execute(index);
      if (state.aborted !== null) return;
      runs.push(run);
      if (run.error) {
        if (state.successes === 0) {
          state.aborted = run.error;
          return;
        }
      } else {
        state.successes += 1;
      }
      options.onProgress?.(runs.length, total);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  runs.sort((a, b) => a.index - b.index);
  return {
    runs,
    elapsedMs: performance.now() - started,
    aborted: state.aborted,
    cancelled: state.cancelled,
  };
}
