import { listen } from "@tauri-apps/api/event";
import type { SavedConnection } from "@/lib/connections";
import { type CsvImportRequest, cancelExecution, csvImport } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

export async function runCsvImport(
  connection: SavedConnection,
  database: string | null,
  request: CsvImportRequest,
  onJob: (id: string) => void,
) {
  const id = crypto.randomUUID();
  const url = effectiveConnectionString(connection);
  startTask(
    {
      id,
      title: `CSV-Import · ${request.schema}.${request.table}`,
      connectionId: connection.id,
      connectionName: connection.name,
      database,
      total: request.rows.length,
    },
    () => cancelExecution(id),
  );
  onJob(id);
  const unlisten = await listen<{ jobId: string; rows: number }>("csv-import-progress", (event) => {
    if (event.payload.jobId === id)
      updateTask(id, {
        progress: event.payload.rows,
        detail: "Zeilen verarbeitet; Übernahme erfolgt gemeinsam am Ende.",
      });
  }).catch(() => () => {});
  try {
    const result = await csvImport(connection.kind, url, request, database ?? undefined, {
      jobId: id,
    });
    finishTask(id, result, result.error);
    return result;
  } catch (error) {
    finishTask(id, undefined, error);
    throw error;
  } finally {
    unlisten();
  }
}
