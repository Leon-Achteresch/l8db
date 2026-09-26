import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { formatBytes } from "@/lib/backup";
import type { SavedConnection } from "@/lib/connections";
import {
  type ObjectProperties,
  s3CancelTransfer,
  s3Download,
  s3Upload,
  type TransferEvent,
  type TransferItem,
  type TransferSummary,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

interface TransfersState {
  active: Record<string, TransferEvent & { bucket: string; label: string }>;
}

export const useTransfers = create<TransfersState>()(() => ({ active: {} }));

export function transferPercent(event: Pick<TransferEvent, "bytes_done" | "bytes_total">): number {
  if (!event.bytes_total) return 0;
  return Math.min(100, Math.round((event.bytes_done / event.bytes_total) * 100));
}

export function transferDetail(event: TransferEvent): string {
  return `${event.files_done}/${event.files_total} Dateien · ${formatBytes(event.bytes_done)} von ${formatBytes(event.bytes_total)}${event.current ? ` · ${event.current}` : ""}`;
}

async function runTransfer(
  connection: SavedConnection,
  bucket: string,
  direction: "upload" | "download",
  label: string,
  start: (id: string) => Promise<TransferSummary>,
): Promise<TransferSummary> {
  const id = crypto.randomUUID();
  startTask(
    {
      id,
      title: `${direction === "upload" ? "Upload" : "Download"} · ${label}`,
      connectionId: connection.id,
      connectionName: connection.name,
      database: bucket,
    },
    () => s3CancelTransfer(id),
  );
  let finished = false;
  const unlisten = await listen<TransferEvent>("s3-transfer", ({ payload }) => {
    if (payload.id !== id || finished) return;
    useTransfers.setState((state) => ({
      active: { ...state.active, [id]: { ...payload, bucket, label } },
    }));
    updateTask(id, {
      progress: transferPercent(payload),
      total: 100,
      detail: transferDetail(payload),
    });
  }).catch(() => () => {});
  try {
    const summary = await start(id);
    if (summary.cancelled) throw new Error("Übertragung vom Benutzer abgebrochen.");
    if (summary.errors.length) throw new Error(summary.errors.slice(0, 5).join("\n"));
    updateTask(id, {
      detail: `${summary.files} Datei(en) · ${formatBytes(summary.bytes)}`,
      progress: 100,
    });
    finishTask(id, summary);
    return summary;
  } catch (error) {
    finishTask(id, undefined, error);
    throw error;
  } finally {
    finished = true;
    try {
      unlisten();
    } catch {}
    useTransfers.setState((state) => {
      const { [id]: _done, ...active } = state.active;
      return { active };
    });
  }
}

export function uploadPaths(
  connection: SavedConnection,
  bucket: string,
  prefix: string,
  paths: string[],
  properties?: ObjectProperties,
): Promise<TransferSummary> {
  const label =
    paths.length === 1 ? (paths[0].split(/[\\/]/).pop() ?? paths[0]) : `${paths.length} Elemente`;
  return runTransfer(connection, bucket, "upload", label, (id) =>
    s3Upload(effectiveConnectionString(connection), bucket, prefix, paths, id, properties),
  );
}

export function downloadItems(
  connection: SavedConnection,
  bucket: string,
  items: TransferItem[],
  target: string,
): Promise<TransferSummary> {
  const label =
    items.length === 1
      ? (items[0].key.replace(/\/$/, "").split("/").pop() ?? items[0].key)
      : `${items.length} Elemente`;
  return runTransfer(connection, bucket, "download", label, (id) =>
    s3Download(effectiveConnectionString(connection), bucket, items, target, id),
  );
}
