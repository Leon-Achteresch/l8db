import type { SqlFormatResult } from "./sql-format";
import type { SqlFormatOptions } from "./sql-format-options";

let formatWorker: Worker | null = null;
let nextFormatId = 0;
const pendingFormats = new Map<
  number,
  { resolve: (result: SqlFormatResult) => void; reject: (error: Error) => void }
>();

export function formatSqlInWorker(
  sql: string,
  options: SqlFormatOptions,
): Promise<SqlFormatResult> {
  if (!formatWorker) {
    formatWorker = new Worker(new URL("./sql-format-worker.ts", import.meta.url), {
      type: "module",
    });
    formatWorker.onmessage = (event: MessageEvent<{ id: number; result: SqlFormatResult }>) => {
      const pending = pendingFormats.get(event.data.id);
      if (!pending) return;
      pendingFormats.delete(event.data.id);
      pending.resolve(event.data.result);
    };
    formatWorker.onerror = () => {
      formatWorker?.terminate();
      formatWorker = null;
      for (const pending of pendingFormats.values())
        pending.reject(new Error("SQL-Formatierung fehlgeschlagen"));
      pendingFormats.clear();
    };
  }
  const id = ++nextFormatId;
  const worker = formatWorker;
  return new Promise((resolve, reject) => {
    pendingFormats.set(id, { resolve, reject });
    worker.postMessage({ id, sql, options });
  });
}
