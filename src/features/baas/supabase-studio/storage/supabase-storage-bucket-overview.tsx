import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FolderOpen, Globe2, Lock } from "lucide-react";
import type { SupabaseBucket } from "@/lib/db";
import { supabaseStudioStorageBuckets } from "@/lib/db/supabase-studio-storage";
import { formatBytes, formatDate, storageQueryKey } from "./storage-format";

export function SupabaseStorageBucketOverview({
  reference,
  onSelect,
}: {
  reference: string;
  onSelect: (bucket: SupabaseBucket) => void;
}) {
  const buckets = useQuery({
    queryKey: storageQueryKey(reference, "buckets", "", 0),
    queryFn: () => supabaseStudioStorageBuckets(reference, "", 0),
    placeholderData: keepPreviousData,
  });

  if (buckets.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(buckets.error)}
      </p>
    );
  if (buckets.isPending) return <p className="text-xs text-muted-foreground">Wird geladen…</p>;
  if (buckets.data.buckets.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
        Noch keine Buckets. Lege links einen an.
      </p>
    );

  return (
    <ul aria-label="Buckets" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {buckets.data.buckets.map((bucket) => (
        <li key={bucket.id}>
          <button
            type="button"
            onClick={() => onSelect(bucket)}
            className="group flex h-full w-full flex-col gap-4 rounded-2xl border bg-card p-4 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/8 text-primary">
                <FolderOpen className="size-5" />
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${bucket.public ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {bucket.public ? <Globe2 className="size-3" /> : <Lock className="size-3" />}
                {bucket.public ? "Öffentlich" : "Privat"}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{bucket.name}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Erstellt {formatDate(bucket.created_at)}
              </span>
            </span>
            <span className="mt-auto grid w-full grid-cols-2 gap-2 border-t pt-3 text-[11px]">
              <span className="min-w-0">
                <span className="block text-muted-foreground">Max. Dateigröße</span>
                <span className="font-medium">
                  {formatBytes(bucket.file_size_limit) || "Unbegrenzt"}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-muted-foreground">Dateitypen</span>
                <span
                  className="block truncate font-medium"
                  title={bucket.allowed_mime_types?.join(", ")}
                >
                  {bucket.allowed_mime_types?.length
                    ? bucket.allowed_mime_types.join(", ")
                    : "Alle"}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
