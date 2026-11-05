import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CLOUD_INFINITE_QUERY_OPTIONS,
  CLOUD_QUERY_OPTIONS,
  type NeonObjectPage,
  neonBuckets,
  neonCreateBucket,
  neonObjects,
  neonStorage,
} from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudLoadMore } from "./cloud-load-more";
import { CloudSectionError } from "./cloud-section-error";

function formatSize(size: number | null): string {
  if (size === null) return "–";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function NeonStoragePanel({
  accountId,
  projectId,
  branchId,
}: {
  accountId: string;
  projectId: string;
  branchId: string;
}) {
  const queryClient = useQueryClient();
  const scope = ["cloud-accounts", accountId, "neon", projectId, branchId, "storage"] as const;
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [newBucket, setNewBucket] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = useQuery({
    queryKey: [...scope, "state"],
    queryFn: () => neonStorage(accountId, projectId, branchId),
    ...CLOUD_QUERY_OPTIONS,
  });
  const buckets = useQuery({
    queryKey: [...scope, "buckets"],
    queryFn: () => neonBuckets(accountId, projectId, branchId),
    enabled: state.data?.enabled === true,
    ...CLOUD_QUERY_OPTIONS,
  });
  const objects = useInfiniteQuery({
    queryKey: [...scope, "objects", bucket, prefix],
    enabled: Boolean(bucket),
    initialPageParam: null as string | null,
    getNextPageParam: (last: NeonObjectPage) =>
      last.is_truncated && last.next_cursor ? last.next_cursor : undefined,
    queryFn: ({ pageParam }) =>
      neonObjects(accountId, projectId, branchId, bucket ?? "", prefix, pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });

  async function create() {
    setBusy(true);
    try {
      const created = await neonCreateBucket(
        accountId,
        projectId,
        branchId,
        newBucket.trim(),
        publicRead,
      );
      toast.success(`Bucket „${created.name}“ angelegt`);
      setNewBucket("");
      await queryClient.invalidateQueries({ queryKey: [...scope, "buckets"] });
    } catch (reason) {
      toast.error(cloudErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  if (state.isLoading) return <p className="text-sm text-muted-foreground">Lade Storage…</p>;
  if (state.isError) {
    return <CloudSectionError error={state.error} onRetry={() => void state.refetch()} />;
  }
  if (!state.data?.enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Neon Object Storage (Beta) ist auf diesem Branch nicht aktiviert. Aktiviere es in der Neon
        Console.
      </p>
    );
  }

  const pages = objects.data?.pages ?? [];
  const folders = pages.flatMap((page) => page.folders);
  const files = pages.flatMap((page) => page.objects);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        S3-Endpunkt: {state.data.s3_endpoint ?? "–"} · Region: {state.data.region ?? "–"}
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          aria-label="Name des neuen Buckets"
          placeholder="neuer-bucket"
          value={newBucket}
          onChange={(event) => setNewBucket(event.target.value)}
          className="w-56"
        />
        <div className="flex items-center gap-2 text-sm">
          <Switch id="neon-bucket-public" checked={publicRead} onCheckedChange={setPublicRead} />
          <label htmlFor="neon-bucket-public">Öffentlich lesbar</label>
        </div>
        <Button type="submit" size="sm" disabled={busy || newBucket.trim().length < 3}>
          <FolderPlus className="size-3.5" />
          Bucket anlegen
        </Button>
      </form>
      {buckets.isError && (
        <CloudSectionError error={buckets.error} onRetry={() => void buckets.refetch()} />
      )}
      <div className="flex flex-wrap gap-2">
        {buckets.data?.map((entry) => (
          <Button
            key={entry.name}
            size="sm"
            variant={bucket === entry.name ? "secondary" : "outline"}
            onClick={() => {
              setBucket(entry.name);
              setPrefix("");
            }}
          >
            {entry.name}
            {entry.access_level === "public_read" && <Badge variant="outline">öffentlich</Badge>}
          </Button>
        ))}
        {buckets.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Noch keine Buckets.</p>
        )}
      </div>
      {bucket && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{bucket}</span>
            <span className="text-muted-foreground">/{prefix}</span>
            {prefix && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPrefix((current) => {
                    const parts = current.split("/").filter(Boolean);
                    parts.pop();
                    return parts.length ? `${parts.join("/")}/` : "";
                  })
                }
              >
                Ebene hoch
              </Button>
            )}
          </div>
          {objects.isError && (
            <CloudSectionError error={objects.error} onRetry={() => void objects.refetch()} />
          )}
          <ul className="divide-y rounded-md border text-sm">
            {folders.map((folder) => (
              <li key={`folder:${folder}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                  onClick={() => setPrefix(folder)}
                >
                  <Folder className="size-3.5" />
                  {folder.slice(prefix.length)}
                </button>
              </li>
            ))}
            {files.map((file) => (
              <li key={file.key} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{file.key.slice(prefix.length)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSize(file.size)} · {file.last_modified ?? "–"}
                </span>
              </li>
            ))}
            {!objects.isLoading && folders.length === 0 && files.length === 0 && (
              <li className="px-3 py-4 text-center text-muted-foreground">Leer.</li>
            )}
          </ul>
          <CloudLoadMore
            hasMore={Boolean(objects.hasNextPage)}
            loading={objects.isFetchingNextPage}
            onLoad={() => void objects.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
