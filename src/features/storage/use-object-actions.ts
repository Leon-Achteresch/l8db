import { useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { formatBytes } from "@/lib/backup";
import { copyText } from "@/lib/clipboard";
import { type ObjectProperties, s3Presign, type TransferItem } from "@/lib/db";
import { basename } from "@/lib/storage/s3";
import { downloadItems, uploadPaths } from "@/lib/storage/transfers";
import type { BrowserRow } from "./use-object-listing";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function transferItem(row: BrowserRow): TransferItem {
  return { key: row.key, version_id: row.versionId ?? null, is_prefix: row.kind === "folder" };
}

export function useObjectActions(bucket: string) {
  const { connection, url, readOnly } = useStorageConnection();
  const queryClient = useQueryClient();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });

  async function upload(prefix: string, paths: string[], properties?: ObjectProperties) {
    if (!connection || paths.length === 0) return;
    if (readOnly) {
      toast.error("Lesemodus: Upload ist gesperrt.");
      return;
    }
    try {
      const summary = await uploadPaths(connection, bucket, prefix, paths, properties);
      toast.success(`${summary.files} Datei(en) hochgeladen · ${formatBytes(summary.bytes)}`);
    } catch (error) {
      toast.error(`Upload fehlgeschlagen: ${errorText(error)}`);
    } finally {
      void refresh();
    }
  }

  async function pickAndUpload(prefix: string, directory: boolean, properties?: ObjectProperties) {
    const picked = await open({
      multiple: true,
      directory,
      title: directory ? "Ordner hochladen" : "Dateien hochladen",
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    await upload(prefix, paths, properties);
  }

  async function download(rows: BrowserRow[]) {
    if (!connection || rows.length === 0) return;
    const items = rows.filter((row) => !row.deleteMarker).map(transferItem);
    if (items.length === 0) return;
    const single = items.length === 1 && !items[0].is_prefix;
    const target = single
      ? await save({ defaultPath: basename(items[0].key), title: "Objekt speichern" })
      : await open({ directory: true, title: "Zielordner wählen" });
    if (!target || Array.isArray(target)) return;
    try {
      const summary = await downloadItems(connection, bucket, items, target);
      toast.success(`${summary.files} Datei(en) heruntergeladen · ${formatBytes(summary.bytes)}`, {
        description: target,
      });
    } catch (error) {
      toast.error(`Download fehlgeschlagen: ${errorText(error)}`);
    }
  }

  async function presign(row: BrowserRow, expiresSecs = 3600, method: "GET" | "PUT" = "GET") {
    return s3Presign(url, bucket, row.key, {
      method,
      expiresSecs,
      versionId: row.versionId && row.versionId !== "null" ? row.versionId : null,
    });
  }

  async function copyPresigned(row: BrowserRow) {
    try {
      await copyText(await presign(row));
      toast.success("Presigned URL (1 Stunde gültig) kopiert.");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function openExternally(row: BrowserRow) {
    try {
      await openUrl(await presign(row, 900));
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return {
    connection,
    url,
    readOnly,
    refresh,
    upload,
    pickAndUpload,
    download,
    presign,
    copyPresigned,
    openExternally,
  };
}
