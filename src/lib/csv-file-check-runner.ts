import { listen } from "@tauri-apps/api/event";
import { type CsvCheckRequest, cancelExecution, checkCsvFile } from "@/lib/db";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

export async function runCsvFileCheck(request: CsvCheckRequest, signal: AbortSignal) {
  const id = crypto.randomUUID();
  let cancelled = signal.aborted;
  let ready = false;
  const cancel = async () => {
    cancelled = true;
    updateTask(id, { detail: "Abbruch der Dateiprüfung angefordert." });
    return ready ? cancelExecution(id) : true;
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
      if (event.payload.jobId !== id) return;
      const first = !ready;
      ready = true;
      updateTask(id, { progress: event.payload.rows });
      if (first && cancelled) void cancelExecution(id).catch(() => {});
    });
    if (cancelled) throw new Error("Dateiprüfung abgebrochen.");
    const result = await checkCsvFile(request, id);
    if (cancelled && result.status === "complete") throw new Error("Dateiprüfung abgebrochen.");
    finishTask(
      id,
      result,
      result.status === "complete" && result.error_count === 0
        ? undefined
        : result.status === "cancelled"
          ? "Dateiprüfung abgebrochen."
          : "Dateiprüfung ohne Freigabe; Bericht beachten.",
    );
    return result;
  } catch (error) {
    finishTask(id, undefined, error);
    throw error;
  } finally {
    unlisten?.();
    signal.removeEventListener("abort", abort);
  }
}
