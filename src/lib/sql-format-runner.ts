import type { SqlFormatResult } from "./sql-format";
import type { SqlFormatOptions } from "./sql-format-options";

let formatWorker: Worker | null = null;
let nextFormatId = 0;
const pendingFormats = new Map<
  number,
  { resolve: (result: SqlFormatResult) => void; reject: (error: unknown) => void }
>();

export function formatSqlInWorker(
  sql: string,
  options: SqlFormatOptions,
  signal?: AbortSignal,
): Promise<SqlFormatResult> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!formatWorker) {
    const worker = new Worker(new URL("./sql-format-worker.ts", import.meta.url), {
      type: "module",
    });
    formatWorker = worker;
    worker.onmessage = (event: MessageEvent<{ id: number; result: SqlFormatResult }>) => {
      const pending = pendingFormats.get(event.data.id);
      if (!pending) return;
      pendingFormats.delete(event.data.id);
      pending.resolve(event.data.result);
    };
    worker.onerror = () => {
      if (formatWorker !== worker) return;
      worker.terminate();
      formatWorker = null;
      for (const pending of pendingFormats.values())
        pending.reject(new Error("SQL-Formatierung fehlgeschlagen"));
      pendingFormats.clear();
    };
  }
  const id = ++nextFormatId;
  const worker = formatWorker;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (!pendingFormats.delete(id)) return;
      reject(signal?.reason);
      if (pendingFormats.size === 0 && formatWorker === worker) {
        worker.terminate();
        formatWorker = null;
      }
    };
    const removeListener = () => signal?.removeEventListener("abort", onAbort);
    pendingFormats.set(id, {
      resolve: (result) => {
        removeListener();
        resolve(result);
      },
      reject: (error) => {
        removeListener();
        reject(error);
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage({ id, sql, options });
    } catch (error) {
      pendingFormats.delete(id);
      removeListener();
      reject(error);
    }
  });
}
