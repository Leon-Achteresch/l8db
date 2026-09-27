import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, File, Folder, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  type FirebaseObject,
  firebaseBuckets,
  firebaseDownloadObject,
  firebaseObjects,
  firebasePreviewObject,
  firebaseUploadObject,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasFilePreview } from "./baas-file-preview";

function formatBytes(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return value;
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

export function FirebaseStorageView({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.storage");
  const uploadFeature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.storage-upload");
  const [bucketPages, setBucketPages] = useState([""]);
  const [bucketName, setBucketName] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [objectPages, setObjectPages] = useState([""]);
  const [preview, setPreview] = useState<FirebaseObject | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const bucketPageToken = bucketPages.at(-1) ?? "";
  const objectPageToken = objectPages.at(-1) ?? "";
  const buckets = useQuery({
    queryKey: ["firebase", projectId, "buckets", bucketPageToken],
    queryFn: () => firebaseBuckets(projectId, bucketPageToken || undefined),
  });
  const selected =
    buckets.data?.items.find((item) => item.name === bucketName) ?? buckets.data?.items[0];
  const objects = useQuery({
    queryKey: ["firebase", projectId, "objects", selected?.name, prefix, objectPageToken],
    queryFn: () => {
      if (!selected) throw new Error("Kein Bucket gewählt.");
      return firebaseObjects(projectId, selected.name, prefix, objectPageToken || undefined);
    },
    enabled: Boolean(selected),
  });

  function selectBucket(name: string) {
    setBucketName(name);
    setPrefix("");
    setObjectPages([""]);
    setPreview(null);
    setUploadError(null);
    setUploaded(null);
  }

  function changeBucketPage(token: string | null) {
    setBucketPages((current) => (token ? [...current, token] : current.slice(0, -1)));
    setBucketName(null);
    setPrefix("");
    setObjectPages([""]);
    setPreview(null);
    setUploadError(null);
    setUploaded(null);
  }

  function openFolder(path: string) {
    setPrefix(path);
    setObjectPages([""]);
    setPreview(null);
    setUploadError(null);
    setUploaded(null);
  }

  async function upload() {
    if (!selected) return;
    setUploading(true);
    setUploadError(null);
    setUploaded(null);
    try {
      const name = await firebaseUploadObject(projectId, selected.name, prefix);
      if (name) {
        setObjectPages([""]);
        setPreview(null);
        setUploaded(`${name.split("/").at(-1)} wurde hochgeladen.`);
        await queryClient.invalidateQueries({
          queryKey: ["firebase", projectId, "objects", selected.name, prefix],
        });
      }
    } catch (reason) {
      setUploadError(String(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Archive className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Cloud Storage</h3>
          {feature.isNew && <NewBadge />}
        </div>
        <div className="flex items-center gap-2">
          <div ref={uploadFeature.ref} className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void upload()}
              disabled={!selected || uploading}
            >
              <Upload className="size-3.5" /> {uploading ? "Lädt hoch…" : "Datei hochladen"}
            </Button>
            {uploadFeature.isNew && <NewBadge />}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Firebase Storage aktualisieren"
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
      ) : (
        <>
          {buckets.data.items.length === 0 && (
            <p className="mt-5 text-xs text-muted-foreground">Keine Buckets auf dieser Seite.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {buckets.data.items.map((bucket) => (
              <button
                key={bucket.name}
                type="button"
                aria-pressed={selected?.name === bucket.name}
                onClick={() => selectBucket(bucket.name)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${selected?.name === bucket.name ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {bucket.name}
              </button>
            ))}
          </div>
          {(bucketPages.length > 1 || buckets.data.nextPageToken) && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bucketPages.length === 1}
                onClick={() => changeBucketPage(null)}
              >
                <ChevronLeft className="size-3.5" /> Vorherige Buckets
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!buckets.data.nextPageToken}
                onClick={() => changeBucketPage(buckets.data.nextPageToken)}
              >
                Weitere Buckets <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
          {selected && (
            <>
              <div className="mt-4 rounded-xl border bg-background/50 p-3">
                <p className="text-xs font-medium">Bucket-Details</p>
                <dl className="mt-3 grid gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Region</dt>
                    <dd className="mt-0.5">{selected.location ?? "Nicht angegeben"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Storage-Klasse</dt>
                    <dd className="mt-0.5">{selected.storageClass ?? "Nicht angegeben"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Erstellt</dt>
                    <dd className="mt-0.5">{formatDate(selected.timeCreated)}</dd>
                  </div>
                </dl>
              </div>
              <div className="mt-5 border-t pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  {prefix && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Übergeordneten Ordner öffnen"
                      onClick={() => {
                        const parent = prefix.split("/").filter(Boolean).slice(0, -1).join("/");
                        openFolder(parent ? `${parent}/` : "");
                      }}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                  )}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    /{selected.name}/{prefix}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Dateiliste aktualisieren"
                    onClick={() => void objects.refetch()}
                    disabled={objects.isFetching}
                  >
                    <RefreshCw className={`size-3.5 ${objects.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                {objects.isPending ? (
                  <p className="mt-4 text-xs text-muted-foreground">Dateien werden geladen…</p>
                ) : objects.isError ? (
                  <p role="alert" className="mt-4 text-xs text-destructive">
                    {String(objects.error)}
                  </p>
                ) : objects.data.prefixes.length === 0 && objects.data.items.length === 0 ? (
                  <p className="mt-4 text-xs text-muted-foreground">Dieser Ordner ist leer.</p>
                ) : (
                  <div className="mt-3 divide-y">
                    {objects.data.prefixes.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="flex w-full items-center gap-2 py-2 text-left text-xs hover:text-primary"
                        onClick={() => openFolder(path)}
                      >
                        <Folder className="size-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">
                          {path.slice(prefix.length).replace(/\/$/, "")}
                        </span>
                      </button>
                    ))}
                    {objects.data.items.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className="flex w-full items-center gap-2 py-2 text-left text-xs hover:text-primary"
                        onClick={() => setPreview(item)}
                      >
                        <File className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate" title={item.name}>
                          {item.name.slice(prefix.length)}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(item.size)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {objects.data && (objectPages.length > 1 || objects.data.nextPageToken) && (
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={objectPages.length === 1}
                      onClick={() => {
                        setObjectPages((current) => current.slice(0, -1));
                        setPreview(null);
                      }}
                    >
                      <ChevronLeft className="size-3.5" /> Zurück
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!objects.data.nextPageToken}
                      onClick={() => {
                        const nextPageToken = objects.data.nextPageToken;
                        if (nextPageToken) {
                          setObjectPages((current) => [...current, nextPageToken]);
                          setPreview(null);
                        }
                      }}
                    >
                      Weiter <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                )}
                {preview && objects.data?.items.some((item) => item.name === preview.name) && (
                  <>
                    <dl className="mt-4 grid gap-3 rounded-xl border bg-background/50 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Dateipfad</dt>
                        <dd className="mt-0.5 break-all font-mono">{preview.name}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">MIME-Typ</dt>
                        <dd className="mt-0.5">{preview.contentType ?? "Nicht angegeben"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Erstellt</dt>
                        <dd className="mt-0.5">{formatDate(preview.timeCreated)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Aktualisiert</dt>
                        <dd className="mt-0.5">{formatDate(preview.updated)}</dd>
                      </div>
                    </dl>
                    <BaasFilePreview
                      key={`${selected.name}:${preview.name}`}
                      name={preview.name.split("/").at(-1) ?? preview.name}
                      queryKey={["firebase", projectId, "preview", selected.name, preview.name]}
                      load={() => firebasePreviewObject(projectId, selected.name, preview.name)}
                      download={() =>
                        firebaseDownloadObject(projectId, selected.name, preview.name)
                      }
                      onClose={() => setPreview(null)}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
