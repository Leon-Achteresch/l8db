import { listen } from "@tauri-apps/api/event";
import type { CsvCheckEvents } from "@/lib/csv-file-check";
import { cancelExecution } from "@/lib/db/core";
import { type CsvCheckRequest, checkCsvFile } from "@/lib/db/csv-check";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

export async function runCsvFileCheck(
  request: CsvCheckRequest,
  signal: AbortSignal,
  events?: CsvCheckEvents,
) {
  const id = crypto.randomUUID();
  let cancelled = signal.aborted;
  let ready = false;
  let finished = false;
  let cancellation: ReturnType<typeof cancelExecution> | undefined;
  let rowsRead = -1;
  const forwardCancel = () => {
    if (!ready || finished) return Promise.resolve(true);
    cancellation ??= cancelExecution(id);
    return cancellation;
  };
  const cancel = async () => {
    if (finished) return true;
    if (!cancelled) {
      cancelled = true;
      updateTask(id, { detail: "Abbruch der Dateiprüfung angefordert." });
      events?.onCancelRequested();
    }
    return forwardCancel();
  };
  const abort = () => {
    void cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  startTask({ id, title: "CSV-Dateiprüfung" }, cancel);
  updateTask(id, { detail: "Nur Struktur und NULL; keine Datenbankzugriffe." });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<{ jobId: string; rows: number }>("csv-check-progress", (event) => {
      if (
        finished ||
        event.payload.jobId !== id ||
        !Number.isSafeInteger(event.payload.rows) ||
        event.payload.rows < 0
      )
        return;
      const first = !ready;
      ready = true;
      if (cancelled) {
        if (first) void forwardCancel().catch(() => {});
        return;
      }
      if (event.payload.rows <= rowsRead) return;
      rowsRead = event.payload.rows;
      updateTask(id, { progress: event.payload.rows });
      events?.onProgress(event.payload.rows);
    });
    if (cancelled) throw new Error("Dateiprüfung vom Benutzer abgebrochen.");
    const result = await checkCsvFile(request, id);
    if (cancelled && result.status === "complete")
      throw new Error("Dateiprüfung vom Benutzer abgebrochen.");
    finishTask(
      id,
      result,
      result.status === "complete" && result.error_count === 0
        ? undefined
        : result.status === "cancelled"
          ? "Dateiprüfung vom Benutzer abgebrochen."
          : "Dateiprüfung ohne Freigabe; Bericht beachten.",
    );
    return result;
  } catch (error) {
    const failure = cancelled ? new Error("Dateiprüfung vom Benutzer abgebrochen.") : error;
    finishTask(id, undefined, failure);
    throw failure;
  } finally {
    finished = true;
    unlisten?.();
    signal.removeEventListener("abort", abort);
  }
}
