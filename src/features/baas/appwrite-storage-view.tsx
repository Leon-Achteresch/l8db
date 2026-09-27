import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, File, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  appwriteBuckets,
  appwriteDownloadFile,
  appwriteFiles,
  appwritePreviewFile,
  appwriteUploadFile,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasFilePreview } from "./baas-file-preview";

function formatBytes(value: number | null): string {
  if (value == null) return "";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : null;
}

function formatFlag(value: boolean | null): string {
  if (value == null) return "Nicht angegeben";
  return value ? "Aktiv" : "Inaktiv";
}

export function AppwriteStorageView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucketOffset, setBucketOffset] = useState(0);
  const [fileOffset, setFileOffset] = useState(0);
  const [preview, setPreview] = useState<{ bucketId: string; fileId: string; name: string } | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const uploadFeature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.storage-upload");
  const detailsFeature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.storage-details");
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

  async function upload() {
    if (!selected || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploaded(null);
    try {
      const fileId = await appwriteUploadFile(id, selected.id);
      if (fileId) {
        setFileOffset(0);
        setPreview(null);
        setUploaded(`Datei in ${selected.name} hochgeladen.`);
        await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "files", selected.id] });
        await queryClient.invalidateQueries({ queryKey: ["appwrite", id, "buckets"] });
      }
    } catch (reason) {
      setUploadError(String(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Storage</h3>
          {buckets.data && (
            <span className="text-xs text-muted-foreground">{buckets.data.total} Buckets</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div ref={uploadFeature.ref} className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void upload()}
              disabled={!selected || uploading}
              title="API-Schlüssel benötigt files.write; es werden keine zusätzlichen Datei-Berechtigungen gesetzt."
            >
              <Upload className="size-3.5" /> {uploading ? "Lädt hoch…" : "Datei hochladen"}
            </Button>
            {uploadFeature.isNew && <NewBadge />}
          </div>
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
      </div>
      {uploadError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {uploadError}
        </p>
      )}
      {uploaded && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {uploaded}
        </p>
      )}
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
                  setUploadError(null);
                  setUploaded(null);
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
          {selected && (
            <div ref={detailsFeature.ref} className="mt-4 rounded-xl border bg-background/50 p-3">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-medium">Bucket-Regeln</h4>
                {detailsFeature.isNew && <NewBadge />}
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">{selected.enabled ? "Aktiv" : "Deaktiviert"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Maximale Dateigröße</dt>
                  <dd className="mt-0.5">
                    {selected.maximum_file_size == null
                      ? "Nicht angegeben"
                      : formatBytes(selected.maximum_file_size)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dateiendungen</dt>
                  <dd className="mt-0.5 break-words">
                    {selected.allowed_file_extensions == null
                      ? "Nicht angegeben"
                      : selected.allowed_file_extensions.length > 0
                        ? selected.allowed_file_extensions.join(", ")
                        : "Alle"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dateiberechtigungen</dt>
                  <dd className="mt-0.5">{formatFlag(selected.file_security)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Kompression</dt>
                  <dd className="mt-0.5">{selected.compression ?? "Nicht angegeben"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verschlüsselung</dt>
                  <dd className="mt-0.5">{formatFlag(selected.encryption)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Virenscan</dt>
                  <dd className="mt-0.5">{formatFlag(selected.antivirus)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Bildtransformationen</dt>
                  <dd className="mt-0.5">{formatFlag(selected.transformations)}</dd>
                </div>
              </dl>
              {selected.permissions && selected.permissions.length > 0 && (
                <div className="mt-3 border-t pt-3 text-xs">
                  <p className="text-muted-foreground">Bucket-Berechtigungen</p>
                  <p className="mt-1 break-all font-mono">{selected.permissions.join(" · ")}</p>
                </div>
              )}
            </div>
          )}
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
                      className="min-w-0 flex-1 text-left hover:text-primary"
                      title={file.key || `${file.folder ?? ""}${file.name}`}
                      onClick={() => {
                        if (selected)
                          setPreview({ bucketId: selected.id, fileId: file.id, name: file.name });
                      }}
                    >
                      <span className="block truncate">
                        {file.key || `${file.folder ?? ""}${file.name}`}
                      </span>
                      {(file.mime_type || formatDate(file.created_at)) && (
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {[file.mime_type, formatDate(file.created_at)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
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
