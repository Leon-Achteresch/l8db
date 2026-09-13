import { writeFile } from "@tauri-apps/plugin-fs";
import type { FullTableExportSource } from "@/features/export/csv-export-dialog";
import type { SavedConnection } from "@/lib/connections";
import { fetchTableRows } from "@/lib/db";
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
      rows = [];
      let offset = 0;
      let bytes = 0;
      const maximum = XLSX_MAX_ROWS - (request.input.options?.header !== false ? 1 : 0);
      for (;;) {
        check();
        const page = await fetchTableRows(
          connection.kind,
          url,
          source.schema,
          source.table,
          source.filter,
          2000,
          offset,
          database ?? undefined,
          source.orderBy ? { column: source.orderBy, desc: source.orderDesc } : undefined,
          source.isView,
          source.filterRaw,
        );
        check();
        if (!page.rows.length) break;
        bytes += new TextEncoder().encode(JSON.stringify(page.rows)).length;
        if (rows.length + page.rows.length > maximum)
          throw new Error(
            "Die Daten überschreiten das Excel-Zeilenlimit. Bitte den Filter einschränken.",
          );
        if (bytes > 64 * 1024 * 1024)
          throw new Error(
            "Der XLSX-Export überschreitet das Speicherlimit von 64 MiB Rohdaten. Bitte Filter einschränken oder CSV verwenden.",
          );
        rows.push(...page.rows);
        offset += page.rows.length;
        updateTask(job, {
          progress: rows.length,
          detail: "Alle gefilterten Zeilen werden gelesen.",
        });
      }
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
