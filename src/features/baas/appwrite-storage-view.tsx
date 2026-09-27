import { useQuery } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, File, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  appwriteBuckets,
  appwriteDownloadFile,
  appwriteFiles,
  appwritePreviewFile,
} from "@/lib/db";
import { BaasFilePreview } from "./baas-file-preview";

function formatBytes(value: number | null): string {
  if (value == null) return "";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

export function AppwriteStorageView({ id }: { id: string }) {
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucketOffset, setBucketOffset] = useState(0);
  const [fileOffset, setFileOffset] = useState(0);
  const [preview, setPreview] = useState<{ bucketId: string; fileId: string; name: string } | null>(
    null,
  );
  const buckets = useQuery({
    queryKey: ["appwrite", id, "buckets", bucketOffset],
    queryFn: () => appwriteBuckets(id, bucketOffset),
  });
  const selected =
    buckets.data?.items.find((item) => item.id === bucketId) ?? buckets.data?.items[0];
  const files = useQuery({
    queryKey: ["appwrite", id, "files", selected?.id, fileOffset],
    queryFn: () => {
      if (!selected) throw new Error("Kein Bucket gewählt.");
      return appwriteFiles(id, selected.id, fileOffset);
    },
    enabled: Boolean(selected),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Archive className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Storage</h3>
        {buckets.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {buckets.data.total} Buckets
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Storage aktualisieren"
          onClick={() => void buckets.refetch()}
          disabled={buckets.isFetching}
        >
          <RefreshCw className={`size-3.5 ${buckets.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {buckets.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Buckets werden geladen…</p>
      ) : buckets.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(buckets.error)}
        </p>
      ) : buckets.data.items.length === 0 ? (
        <p className="mt-5 text-xs text-muted-foreground">Keine Buckets vorhanden.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {buckets.data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => {
                  setBucketId(item.id);
                  setFileOffset(0);
                  setPreview(null);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${selected?.id === item.id ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {item.name}{" "}
                <span className="ml-1 text-muted-foreground">{formatBytes(item.total_size)}</span>
              </button>
            ))}
          </div>
          {bucketOffset > 0 || bucketOffset + buckets.data.items.length < buckets.data.total ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Vorherige Buckets"
                disabled={bucketOffset === 0}
                onClick={() => setBucketOffset((value) => Math.max(0, value - 100))}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Weitere Buckets"
                disabled={bucketOffset + buckets.data.items.length >= buckets.data.total}
                onClick={() => {
                  setBucketOffset((value) => value + 100);
                  setBucketId(null);
                  setFileOffset(0);
                  setPreview(null);
                }}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
          <div className="mt-5 border-t pt-4">
            <div className="flex items-center gap-2 text-xs font-medium">
              <File className="size-3.5 text-muted-foreground" /> Dateien in {selected?.name}
              {files.data && (
                <span className="ml-auto text-muted-foreground">{files.data.total}</span>
              )}
            </div>
            {files.isPending ? (
              <p className="mt-4 text-xs text-muted-foreground">Dateien werden geladen…</p>
            ) : files.isError ? (
              <p role="alert" className="mt-4 text-xs text-destructive">
                {String(files.error)}
              </p>
            ) : files.data.items.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">Keine Dateien vorhanden.</p>
            ) : (
              <div className="mt-3 divide-y">
                {files.data.items.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 py-2 text-xs">
                    <File className="size-3.5 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:text-primary"
                      title={file.name}
                      onClick={() => {
                        if (selected)
                          setPreview({ bucketId: selected.id, fileId: file.id, name: file.name });
                      }}
                    >
                      {file.name}
                    </button>
                    <span className="shrink-0 text-muted-foreground">
                      {formatBytes(file.size_original)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {files.data &&
              (fileOffset > 0 || fileOffset + files.data.items.length < files.data.total) && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Vorherige Dateien"
                    disabled={fileOffset === 0}
                    onClick={() => {
                      setFileOffset((value) => Math.max(0, value - 100));
                      setPreview(null);
                    }}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {fileOffset + 1}–{fileOffset + files.data.items.length} / {files.data.total}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Weitere Dateien"
                    disabled={fileOffset + files.data.items.length >= files.data.total}
                    onClick={() => {
                      setFileOffset((value) => value + 100);
                      setPreview(null);
                    }}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
            {preview && preview.bucketId === selected?.id && (
              <BaasFilePreview
                key={`${preview.bucketId}:${preview.fileId}`}
                name={preview.name}
                queryKey={["appwrite", id, "preview", preview.bucketId, preview.fileId]}
                load={() => appwritePreviewFile(id, preview.bucketId, preview.fileId)}
                download={() =>
                  appwriteDownloadFile(id, preview.bucketId, preview.fileId, preview.name)
                }
                onClose={() => setPreview(null)}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
