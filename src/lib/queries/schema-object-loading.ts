import {
  type QueryClient,
  type QueryFunctionContext,
  type QueryKey,
  QueryObserver,
} from "@tanstack/react-query";

const METADATA_CONCURRENCY = 2;
const scopes = new WeakMap<QueryClient, Map<string, MetadataQueue>>();

interface MetadataQueue {
  active: number;
  waiting: (() => void)[];
}

export interface SharedMetadataQuery<T> {
  queryKey: QueryKey;
  queryFn: (context: QueryFunctionContext) => Promise<T>;
}

function aborted() {
  return new DOMException("Abfrage abgebrochen", "AbortError");
}

export function runSchemaMetadataRequest<T>(
  client: QueryClient,
  scope: string,
  signal: AbortSignal,
  run: (jobId: string) => Promise<T>,
  cancel: (jobId: string) => unknown,
): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  let clientScopes = scopes.get(client);
  if (!clientScopes) {
    clientScopes = new Map();
    scopes.set(client, clientScopes);
  }
  let queue = clientScopes.get(scope);
  if (!queue) {
    queue = { active: 0, waiting: [] };
    clientScopes.set(scope, queue);
  }
  const currentScopes = clientScopes;
  const currentQueue = queue;
  const cleanup = () => {
    if (!currentQueue.active && !currentQueue.waiting.length) currentScopes.delete(scope);
  };
  return new Promise<T>((resolve, reject) => {
    const cancelWaiting = () => {
      const index = currentQueue.waiting.indexOf(start);
      if (index < 0) return;
      currentQueue.waiting.splice(index, 1);
      reject(aborted());
      cleanup();
    };
    const start = () => {
      signal.removeEventListener("abort", cancelWaiting);
      if (signal.aborted) {
        reject(aborted());
        cleanup();
        return;
      }
      currentQueue.active++;
      const jobId = crypto.randomUUID();
      let dispatched = false;
      const onAbort = () => {
        if (dispatched)
          void Promise.resolve()
            .then(() => cancel(jobId))
            .catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          dispatched = true;
          return run(jobId);
        })
        .then((value) => {
          signal.throwIfAborted();
          resolve(value);
        })
        .catch(reject)
        .finally(() => {
          signal.removeEventListener("abort", onAbort);
          currentQueue.active--;
          currentQueue.waiting.shift()?.();
          cleanup();
        });
    };
    if (currentQueue.active < METADATA_CONCURRENCY) start();
    else {
      currentQueue.waiting.push(start);
      signal.addEventListener("abort", cancelWaiting, { once: true });
    }
  });
}

function observeSharedMetadata<T>(
  client: QueryClient,
  signal: AbortSignal,
  options: SharedMetadataQuery<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const observer = new QueryObserver(client, { ...options, staleTime: 60_000 });
    let settled = false;
    const cleanup = () => {
      settled = true;
      signal.removeEventListener("abort", onAbort);
      observer.destroy();
    };
    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(aborted());
    };
    const check = () => {
      if (settled) return;
      const result = observer.getCurrentResult();
      if (result.fetchStatus !== "idle") return;
      if (result.isSuccess) {
        cleanup();
        resolve(result.data);
      } else if (result.isError) {
        cleanup();
        reject(result.error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    observer.subscribe(check);
    check();
  });
}

export async function loadSharedSchemaObjects<T extends Record<string, unknown>>(
  client: QueryClient,
  signal: AbortSignal,
  queries: { [Key in keyof T]: SharedMetadataQuery<T[Key]> },
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const values = await Promise.all(
      Object.entries(queries).map(async ([key, query]) => [
        key,
        await observeSharedMetadata(client, controller.signal, query),
      ]),
    );
    return Object.fromEntries(values) as T;
  } finally {
    controller.abort();
    signal.removeEventListener("abort", onAbort);
  }
}
