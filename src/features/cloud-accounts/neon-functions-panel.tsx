import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CLOUD_INFINITE_QUERY_OPTIONS,
  CLOUD_QUERY_OPTIONS,
  type CloudPage,
  type NeonFunction,
  neonFunction,
  neonFunctions,
} from "@/lib/db/cloud-accounts";
import { CloudLoadMore } from "./cloud-load-more";
import { CloudSectionError } from "./cloud-section-error";

export function NeonFunctionsPanel({
  accountId,
  projectId,
  branchId,
}: {
  accountId: string;
  projectId: string;
  branchId: string;
}) {
  const scope = ["cloud-accounts", accountId, "neon", projectId, branchId, "functions"] as const;
  const [selected, setSelected] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: [...scope, "list"],
    initialPageParam: null as string | null,
    getNextPageParam: (last: CloudPage<NeonFunction>) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) => neonFunctions(accountId, projectId, branchId, pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const detail = useQuery({
    queryKey: [...scope, "detail", selected],
    queryFn: () => neonFunction(accountId, projectId, branchId, selected ?? ""),
    enabled: Boolean(selected),
    ...CLOUD_QUERY_OPTIONS,
  });

  if (list.isLoading) return <p className="text-sm text-muted-foreground">Lade Functions…</p>;
  if (list.isError) {
    return <CloudSectionError error={list.error} onRetry={() => void list.refetch()} />;
  }
  const functions = list.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = detail.data ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {functions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Auf diesem Branch gibt es keine Functions.
          </p>
        )}
        <ul className="divide-y rounded-md border text-sm">
          {functions.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted ${selected === entry.slug ? "bg-muted" : ""}`}
                onClick={() => setSelected(entry.slug)}
              >
                <span className="truncate">{entry.name}</span>
                <Badge variant="outline">
                  {entry.active_deployment?.status ?? entry.current_deployment?.status ?? "–"}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        <CloudLoadMore
          hasMore={Boolean(list.hasNextPage)}
          loading={list.isFetchingNextPage}
          onLoad={() => void list.fetchNextPage()}
        />
      </div>
      <div className="rounded-md border p-3 text-sm">
        {!selected && <p className="text-muted-foreground">Function auswählen.</p>}
        {detail.isError && <CloudSectionError error={detail.error} />}
        {shown && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{shown.name}</dd>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono">{shown.slug}</dd>
            <dt className="text-muted-foreground">Aufruf-URL</dt>
            <dd className="break-all font-mono text-xs">{shown.invocation_url ?? "–"}</dd>
            <dt className="text-muted-foreground">Aktiv</dt>
            <dd>
              {shown.active_deployment
                ? `${shown.active_deployment.status ?? "–"} · ${shown.active_deployment.runtime ?? "–"} · ${shown.active_deployment.memory_mib ?? "–"} MiB`
                : "–"}
            </dd>
            <dt className="text-muted-foreground">Neueste</dt>
            <dd>
              {shown.current_deployment
                ? `${shown.current_deployment.status ?? "–"} · ${shown.current_deployment.created_at ?? "–"}`
                : "–"}
            </dd>
            {shown.current_deployment?.error && (
              <>
                <dt className="text-muted-foreground">Fehler</dt>
                <dd className="text-destructive">{shown.current_deployment.error}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Angelegt</dt>
            <dd>{shown.created_at ?? "–"}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
