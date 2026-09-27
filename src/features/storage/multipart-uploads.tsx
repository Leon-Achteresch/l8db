import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { s3AbortMultipartUpload, s3ListMultipartUploads } from "@/lib/db";
import { errorText, formatDate, useStorageConnection } from "./use-storage-connection";

export function MultipartUploads({ bucket }: { bucket: string }) {
  const { connection, url, readOnly } = useStorageConnection();
  const queryClient = useQueryClient();
  const uploads = useQuery({
    queryKey: ["s3", connection?.id, "multipart", bucket],
    queryFn: () => s3ListMultipartUploads(url, bucket),
  });

  async function abort(key: string, uploadId: string) {
    try {
      await s3AbortMultipartUpload(url, bucket, key, uploadId);
      toast.success("Upload abgebrochen");
      await queryClient.invalidateQueries({
        queryKey: ["s3", connection?.id, "multipart", bucket],
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const list = uploads.data ?? [];
  return (
    <div className="mx-auto grid max-w-4xl gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="text-sm font-medium">Unvollständige Multipart-Uploads</h2>
          <p className="text-xs text-muted-foreground">
            Abgebrochene Uploads belegen weiterhin Speicher, bis sie beendet oder per
            Lifecycle-Regel entfernt werden.
          </p>
        </div>
        <IconButton
          size="icon-sm"
          variant="ghost"
          aria-label="Aktualisieren"
          onClick={() => void uploads.refetch()}
        >
          <RefreshCwIcon className={uploads.isFetching ? "animate-spin" : undefined} />
        </IconButton>
        {!readOnly && list.length > 1 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              for (const upload of list) await abort(upload.key, upload.upload_id);
            }}
          >
            Alle abbrechen
          </Button>
        )}
      </div>
      {uploads.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Lade…
        </div>
      ) : uploads.isError ? (
        <p className="text-sm break-words text-destructive">{errorText(uploads.error)}</p>
      ) : list.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Keine unvollständigen Uploads.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Schlüssel</th>
              <th className="py-1 font-medium">Gestartet</th>
              <th className="py-1 font-medium">Upload-ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((upload) => (
              <tr key={upload.upload_id} className="border-t">
                <td className="max-w-72 truncate py-1.5 font-mono" title={upload.key}>
                  {upload.key}
                </td>
                <td className="py-1.5">{formatDate(upload.initiated)}</td>
                <td
                  className="max-w-48 truncate py-1.5 font-mono text-muted-foreground"
                  title={upload.upload_id}
                >
                  {upload.upload_id}
                </td>
                <td className="py-1.5 text-right">
                  {!readOnly && (
                    <IconButton
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Upload ${upload.key} abbrechen`}
                      onClick={() => void abort(upload.key, upload.upload_id)}
                    >
                      <XIcon />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
