import { writeFile } from "@tauri-apps/plugin-fs";
import type { FullTableExportSource } from "@/features/export/csv-export-dialog";
import type { SavedConnection } from "@/lib/connections";
import { cancelExecution, readTableSnapshot } from "@/lib/db";
import { applyMasks, type ColumnMask } from "@/lib/export";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import { type buildXlsx, XLSX_MAX_ROWS } from "@/lib/xlsx";

export async function runXlsxExport(request: {
  path: string;
  input: Parameters<typeof buildXlsx>[0];
  masks: ColumnMask[];
  source?: FullTableExportSource;
  connection?: SavedConnection | null;
  database?: string | null;
  onJob?: (id: string) => void;
}) {
  const { source, connection, database } = request;
  const url = connection ? effectiveConnectionString(connection) : null;
  let stopped = false;
  let worker: Worker | null = null;
  let rejectWorker: ((error: Error) => void) | null = null;
  const job = startTask(
    {
      title: "XLSX-Export",
      connectionId: connection?.id,
      connectionName: connection?.name,
      database,
      total: source?.totalRows ?? undefined,
    },
    async () => {
      stopped = true;
      worker?.terminate();
      rejectWorker?.(new Error("Export vom Benutzer abgebrochen."));
      await cancelExecution(job);
      updateTask(job, {
        detail: "Abbruch angefordert; eine laufende Leseseite wird noch abgewartet.",
      });
    },
  );
  request.onJob?.(job);
  const check = () => {
    if (stopped) throw new Error("Export vom Benutzer abgebrochen.");
  };
  try {
    let rows = request.input.rows;
    if (source && connection && url) {
      const snapshot = await readTableSnapshot(
        connection.kind,
        url,
        database ?? undefined,
        {
          schema: source.schema,
          table: source.table,
          filter: source.filter ?? undefined,
          allowRawFilter: source.filterRaw ?? false,
          orderBy: source.orderBy ?? undefined,
          orderDesc: source.orderDesc ?? false,
          isView: source.isView ?? false,
          maxRows: XLSX_MAX_ROWS - (request.input.options?.header !== false ? 1 : 0),
        },
        { jobId: job, track: false },
      );
      rows = snapshot.rows;
    }
    check();
    updateTask(job, { progress: rows.length, detail: "Excel-Datei wird erstellt." });
    const input = {
      ...request.input,
      rows: applyMasks(request.input.columns, rows, request.masks),
    };
    worker = new Worker(new URL("./xlsx-worker.ts", import.meta.url), { type: "module" });
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      rejectWorker = reject;
      worker!.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; error?: string }>) =>
        event.data.bytes
          ? resolve(event.data.bytes)
          : reject(new Error(event.data.error ?? "XLSX-Erstellung fehlgeschlagen"));
      worker!.onerror = () => reject(new Error("XLSX-Erstellung fehlgeschlagen"));
      worker!.postMessage(input);
    });
    check();
    updateTask(job, { cancellable: false, detail: "Datei wird gespeichert." });
    await writeFile(request.path, bytes);
    updateTask(job, { total: rows.length, detail: "Datei gespeichert." });
    finishTask(job, { rows: rows.length, file: request.path.split(/[\\/]/).pop() });
    return rows.length;
  } catch (error) {
    finishTask(job, undefined, error);
    throw error;
  } finally {
    worker?.terminate();
  }
}
