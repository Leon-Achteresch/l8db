import { useQuery } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, File, Folder, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  supabaseBuckets,
  supabaseDownloadObject,
  supabaseHasProjectKey,
  supabaseObjects,
  supabasePreviewObject,
} from "@/lib/db";
import { BaasFilePreview } from "./baas-file-preview";

function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

export function SupabaseStorageView({ reference }: { reference: string }) {
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<{ bucket: string; key: string; name: string } | null>(
    null,
  );
  const buckets = useQuery({
    queryKey: ["supabase", reference, "buckets"],
    queryFn: () => supabaseBuckets(reference),
  });
  const hasKey = useQuery({
    queryKey: ["supabase", reference, "has-project-key"],
    queryFn: () => supabaseHasProjectKey(reference),
  });
  const selected = buckets.data?.find((entry) => entry.name === bucket) ?? buckets.data?.[0];
  const objects = useQuery({
    queryKey: ["supabase", reference, "objects", selected?.name, prefix, offset],
    queryFn: () => {
      if (!selected) throw new Error("Kein Bucket gewählt.");
      return supabaseObjects(reference, selected.name, prefix, offset);
    },
    enabled: Boolean(selected && hasKey.data),
  });

  function openBucket(name: string) {
    setBucket(name);
    setPrefix("");
    setOffset(0);
    setPreview(null);
  }

  function up() {
    setPreview(null);
    setPrefix((current) => {
      const parent = current.split("/").filter(Boolean).slice(0, -1).join("/");
      return parent ? `${parent}/` : "";
    });
    setOffset(0);
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Storage</h3>
          {buckets.data && (
            <span className="text-xs text-muted-foreground">{buckets.data.length} Buckets</span>
          )}
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
      {buckets.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Buckets werden geladen…</p>
      ) : buckets.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(buckets.error)}
        </p>
      ) : (
        <>
          {buckets.data.length === 0 && (
            <p className="mt-5 text-xs text-muted-foreground">Keine Buckets vorhanden.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {buckets.data.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => openBucket(entry.name)}
                aria-pressed={selected?.id === entry.id}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${selected?.id === entry.id ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {entry.name}{" "}
                <span className="ml-1 text-muted-foreground">
                  {entry.public ? "öffentlich" : "privat"}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t pt-4">
            {hasKey.isPending ? (
              <p className="text-xs text-muted-foreground">API-Zugriff wird geprüft…</p>
            ) : hasKey.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {String(hasKey.error)}
              </p>
            ) : !hasKey.data ? (
              <p className="text-xs text-muted-foreground">
                Hinterlege den Projekt API Key oben, um Dateien zu sehen.
              </p>
            ) : !selected ? (
              <p className="text-xs text-muted-foreground">Keine Bucket-Dateien zum Anzeigen.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {prefix && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Übergeordneten Ordner öffnen"
                        onClick={up}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                    )}
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      /{selected?.name}/{prefix}
                    </p>
                  </div>
                </div>
                {objects.isPending ? (
                  <p className="mt-4 text-xs text-muted-foreground">Dateien werden geladen…</p>
                ) : objects.isError ? (
                  <p role="alert" className="mt-4 text-xs text-destructive">
                    {String(objects.error)}
                  </p>
                ) : objects.data.length === 0 ? (
                  <p className="mt-4 text-xs text-muted-foreground">Dieser Ordner ist leer.</p>
                ) : (
                  <div className="mt-3 divide-y">
                    {objects.data.map((entry) => {
                      const folder = entry.id === null;
                      return (
                        <div
                          key={`${entry.id ?? "folder"}:${entry.name}`}
                          className="flex items-center gap-2 py-2 text-xs"
                        >
                          {folder ? (
                            <Folder className="size-3.5 shrink-0 text-primary" />
                          ) : (
                            <File className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {folder ? (
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left hover:text-primary"
                              onClick={() => {
                                setPrefix(`${prefix}${entry.name}/`);
                                setOffset(0);
                                setPreview(null);
                              }}
                            >
                              {entry.name}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left hover:text-primary"
                              title={entry.name}
                              onClick={() =>
                                setPreview({
                                  bucket: selected.name,
                                  key: `${prefix}${entry.name}`,
                                  name: entry.name,
                                })
                              }
                            >
                              {entry.name}
                            </button>
                          )}
                          <span className="shrink-0 text-muted-foreground">
                            {formatBytes(entry.metadata?.size)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(offset > 0 || (objects.data?.length ?? 0) === 100) && (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset === 0}
                      onClick={() => {
                        setOffset((value) => Math.max(0, value - 100));
                        setPreview(null);
                      }}
                    >
                      Zurück
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {offset + 1}–{offset + (objects.data?.length ?? 0)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(objects.data?.length ?? 0) < 100}
                      onClick={() => {
                        setOffset((value) => value + 100);
                        setPreview(null);
                      }}
                    >
                      Weiter <ChevronRight className="size-3" />
                    </Button>
                  </div>
                )}
                {preview && preview.bucket === selected.name && (
                  <BaasFilePreview
                    key={`${preview.bucket}:${preview.key}`}
                    name={preview.name}
                    queryKey={["supabase", reference, "preview", preview.bucket, preview.key]}
                    load={() => supabasePreviewObject(reference, preview.bucket, preview.key)}
                    download={() => supabaseDownloadObject(reference, preview.bucket, preview.key)}
                    onClose={() => setPreview(null)}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
