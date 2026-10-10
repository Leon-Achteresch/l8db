export interface PartialProgress {
  applied: number;
  total: number;
}

export class MultiTargetCancelled extends Error {
  readonly partial: PartialProgress | null;

  constructor(partial: PartialProgress | null = null) {
    super("Abgebrochen.");
    this.name = "MultiTargetCancelled";
    this.partial = partial;
  }
}

export class MultiTargetStatementError extends Error {
  readonly partial: PartialProgress;

  constructor(message: string, partial: PartialProgress) {
    super(message);
    this.name = "MultiTargetStatementError";
    this.partial = partial;
  }
}

export function isMultiTargetCancelled(error: unknown): error is MultiTargetCancelled {
  return error instanceof MultiTargetCancelled;
}

interface Entry {
  key: string;
  start: () => void;
}

export interface Limiter {
  run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly active: number;
  readonly queued: number;
  readonly peak: number;
  readonly started: number;
}

export function createLimiter(limit: number, perKey = Number.POSITIVE_INFINITY): Limiter {
  const max = Math.max(1, Math.floor(limit));
  const keyMax = Math.max(1, Math.floor(perKey));
  const queue: Entry[] = [];
  const perKeyActive = new Map<string, number>();
  let active = 0;
  let peak = 0;
  let started = 0;

  const pump = () => {
    for (let index = 0; index < queue.length && active < max; ) {
      const entry = queue[index];
      if ((perKeyActive.get(entry.key) ?? 0) >= keyMax) {
        index++;
        continue;
      }
      queue.splice(index, 1);
      entry.start();
    }
  };

  return {
    run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(new MultiTargetCancelled());
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(new MultiTargetCancelled());
        };
        const entry: Entry = {
          key,
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            active++;
            started++;
            peak = Math.max(peak, active);
            perKeyActive.set(key, (perKeyActive.get(key) ?? 0) + 1);
            let pending: Promise<T>;
            try {
              pending = task();
            } catch (error) {
              pending = Promise.reject(error);
            }
            pending.then(resolve, reject).finally(() => {
              active--;
              const remaining = (perKeyActive.get(key) ?? 1) - 1;
              if (remaining > 0) perKeyActive.set(key, remaining);
              else perKeyActive.delete(key);
              pump();
            });
          },
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    get peak() {
      return peak;
    },
    get started() {
      return started;
    },
  };
}
