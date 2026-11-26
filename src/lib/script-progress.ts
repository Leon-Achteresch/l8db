import type { ScriptRunEntry } from "@/features/query/script-result-list";

const PROGRESS_INTERVAL_MS = 50;

export function createScriptProgress(
  entries: ScriptRunEntry[],
  onProgress: ((snapshot: ScriptRunEntry[]) => void) | undefined,
  onCount: (completed: number) => void,
) {
  let snapshot: ScriptRunEntry[] | undefined;
  let first = entries.length;
  let last = -1;
  let completed = 0;
  let publishedCount = 0;
  let publishedAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let callbackFailure: { error: unknown } | undefined;

  function cancelTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function flush() {
    cancelTimer();
    if (callbackFailure) throw callbackFailure.error;
    if (last < first) return;
    if (onProgress) {
      if (snapshot) {
        snapshot = snapshot.slice();
        for (let i = first; i <= last; i++) snapshot[i] = { ...entries[i] };
      } else snapshot = entries.map((entry) => ({ ...entry }));
    }
    first = entries.length;
    last = -1;
    publishedAt = performance.now();
    if (publishedCount !== completed) {
      publishedCount = completed;
      onCount(completed);
    }
    if (snapshot) onProgress?.(snapshot);
  }

  function changed(entry: ScriptRunEntry, finished = false) {
    if (callbackFailure) throw callbackFailure.error;
    if (finished) completed++;
    else if (!onProgress) return;
    first = Math.min(first, entry.index);
    last = Math.max(last, entry.index);
    const remaining = PROGRESS_INTERVAL_MS - (performance.now() - publishedAt);
    if (remaining <= 0) flush();
    else if (timer === undefined)
      timer = setTimeout(() => {
        try {
          flush();
        } catch (error) {
          callbackFailure = { error };
        }
      }, remaining);
  }

  return { changed, flush, cancelTimer };
}
