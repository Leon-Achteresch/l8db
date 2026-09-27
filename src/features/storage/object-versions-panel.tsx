import { useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { DownloadIcon, RotateCcwIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/backup";
import { s3DeleteObjects, s3ListObjectVersions, s3RestoreVersion } from "@/lib/db";
import { basename } from "@/lib/storage/s3";
import { downloadItems } from "@/lib/storage/transfers";
import { errorText, formatDate, useStorageConnection } from "./use-storage-connection";

export function ObjectVersionsPanel({
  bucket,
  objectKey,
  readOnly,
}: {
  bucket: string;
  objectKey: string;
  readOnly: boolean;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ["s3", connection?.id, "versions", bucket, objectKey],
    queryFn: async () => {
      const page = await s3ListObjectVersions(url, bucket, objectKey, { delimiter: null });
      return page.versions.filter((v) => v.key === objectKey);
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  if (versions.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade Versionen…
      </div>
    );
  }
  if (versions.isError)
    return <p className="text-sm break-words text-destructive">{errorText(versions.error)}</p>;
  const list = versions.data ?? [];
  if (list.length <= 1 && list[0]?.version_id === "null") {
    return (
      <p className="text-sm text-muted-foreground">
        Keine Versionen – Versionierung ist für diesen Bucket nicht aktiv.
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5">
      {list.map((version) => (
        <li key={version.version_id} className="rounded-md border p-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono" title={version.version_id}>
              {version.version_id}
            </span>
            {version.is_latest && <Badge variant="secondary">aktuell</Badge>}
            {version.delete_marker && <Badge variant="outline">Delete-Marker</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-muted-foreground">
            <span>{formatDate(version.last_modified)}</span>
            {!version.delete_marker && <span>{formatBytes(version.size)}</span>}
            <span className="ml-auto flex gap-0.5">
              {!version.delete_marker && connection && (
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Version herunterladen"
                  onClick={async () => {
                    const target = await save({ defaultPath: basename(objectKey) });
                    if (target)
                      await run(
                        () =>
                          downloadItems(
                            connection,
                            bucket,
                            [{ key: objectKey, version_id: version.version_id, is_prefix: false }],
                            target,
                          ),
                        "Version heruntergeladen",
                      );
                  }}
                >
                  <DownloadIcon />
                </IconButton>
              )}
              {!readOnly && !version.is_latest && !version.delete_marker && (
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Version wiederherstellen"
                  onClick={() =>
                    void run(
                      () => s3RestoreVersion(url, bucket, objectKey, version.version_id),
                      "Version wiederhergestellt",
                    )
                  }
                >
                  <RotateCcwIcon />
                </IconButton>
              )}
              {!readOnly && (
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Version endgültig löschen"
                  onClick={() =>
                    void run(async () => {
                      const outcome = await s3DeleteObjects(url, bucket, [
                        { key: objectKey, version_id: version.version_id },
                      ]);
                      if (outcome.errors.length) throw new Error(outcome.errors.join("\n"));
                    }, "Version gelöscht")
                  }
                >
                  <TrashIcon />
                </IconButton>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
