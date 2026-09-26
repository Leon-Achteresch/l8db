import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, ArrowRight, Plus, RefreshCw, Search, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DisconnectButton } from "@/features/connections/disconnect-button";
import { RecentQueries } from "@/features/home/connected-dashboard/recent-queries";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { s3ListBuckets } from "@/lib/db";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useTableTabs } from "@/lib/table-tabs";
import { CreateBucketDialog } from "./create-bucket-dialog";
import { errorText, formatDate, useStorageConnection } from "./use-storage-connection";

function endpointOf(connectionString: string): string {
  try {
    return new URL(connectionString).searchParams.get("endpoint") || "Amazon S3";
  } catch {
    return "Amazon S3";
  }
}

const EXAMPLES = [
  "SHOW BUCKETS",
  "LIST s3://demo/data/",
  "SELECT * FROM s3://demo/data/customers.csv LIMIT 10",
];

export function StorageDashboard({ connection }: { connection: SavedConnection }) {
  const { url, readOnly } = useStorageConnection();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const buckets = useQuery({
    queryKey: ["s3", connection.id, "buckets"],
    queryFn: () => s3ListBuckets(url),
    enabled: Boolean(url),
  });
  const history = useQueryHistoryStore((state) => state.entries);
  const recent = history.filter((entry) => entry.connectionId === connection.id).slice(0, 4);
  const provider = providerFor(connection);
  const endpoint = endpointOf(connection.connectionString);
  const needle = search.trim().toLowerCase();
  const items = (buckets.data ?? []).filter((bucket) => bucket.name.toLowerCase().includes(needle));

  function openBucket(bucket: string) {
    useTableTabs.getState().openBucketTab({ bucket });
    void navigate({ to: "/buckets/$bucket", params: { bucket } });
  }

  function newQuery(sql?: string) {
    const tabs = useTableTabs.getState();
    const id = sql ? tabs.openQueryTabWithSql(sql) : tabs.openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <main className="workspace-canvas flex-1 overflow-auto" data-tour="dashboard">
      <div className="mx-auto max-w-[1400px] px-6 py-8 lg:px-9">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="eyebrow">Objektspeicher</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-[11px] text-muted-foreground">{provider.name}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">{connection.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="max-w-96 truncate font-mono">{endpoint}</span>
              <span className="size-1 rounded-full bg-border" />
              <span>
                {buckets.data
                  ? `${buckets.data.length} Buckets`
                  : buckets.isError
                    ? "Nicht erreichbar"
                    : "Lade…"}
              </span>
              {readOnly && (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <span>Lesemodus</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DisconnectButton />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void buckets.refetch()}
              disabled={buckets.isFetching}
              aria-label="Buckets aktualisieren"
            >
              <RefreshCw className={`size-3.5 ${buckets.isFetching ? "animate-spin" : ""}`} />
            </Button>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" />
                Bucket
              </Button>
            )}
            <Button size="sm" onClick={() => newQuery()}>
              <SquareTerminal className="size-3.5" />
              Abfrage
            </Button>
          </div>
        </header>
        <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(270px,1fr)]">
          <div className="min-w-0 space-y-7">
            <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Buckets">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <h2 className="text-sm font-semibold">Buckets</h2>
                <div className="relative">
                  <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    className="h-7 w-44 rounded-lg pl-8 text-xs"
                    aria-label="Buckets in der Übersicht suchen"
                    placeholder="Bucket suchen…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
              {buckets.isPending ? (
                <div className="space-y-4 p-5">
                  {[0, 1, 2].map((item) => (
                    <Skeleton key={item} className="h-7 w-full" />
                  ))}
                </div>
              ) : buckets.isError ? (
                <div className="p-5">
                  <p role="alert" className="text-xs leading-relaxed break-words text-destructive">
                    {errorText(buckets.error)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void buckets.refetch()}
                  >
                    Erneut versuchen
                  </Button>
                </div>
              ) : items.length ? (
                <div className="max-h-96 divide-y divide-border/60 overflow-auto">
                  {items.map((bucket) => (
                    <Link
                      key={bucket.name}
                      to="/buckets/$bucket"
                      params={{ bucket: bucket.name }}
                      onClick={() => useTableTabs.getState().openBucketTab({ bucket: bucket.name })}
                      className="group flex items-center gap-3 px-5 py-3 hover:bg-muted/60"
                    >
                      <ArchiveIcon className="size-4 text-orange-500" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {bucket.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(bucket.creation_date)}
                      </span>
                      <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <ArchiveIcon className="mx-auto mb-3 size-6 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {search ? "Kein passender Bucket gefunden." : "Noch keine Buckets vorhanden."}
                  </p>
                  {!search && !readOnly && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="size-3" />
                      Bucket erstellen
                    </Button>
                  )}
                </div>
              )}
            </section>
            <RecentQueries recent={recent} />
          </div>
          <aside className="space-y-6">
            <section className="rounded-2xl bg-primary/[0.055] p-5">
              <SquareTerminal className="mb-3 size-5 text-primary" />
              <h2 className="text-sm font-semibold">Abfragen auf Objekten</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Buckets auflisten, Präfixe durchsuchen und CSV-, JSON- oder Parquet-Dateien per S3
                Select abfragen.
              </p>
              <div className="mt-3 grid gap-1.5">
                {EXAMPLES.map((sql) => (
                  <button
                    key={sql}
                    type="button"
                    className="truncate rounded-md border bg-card px-2.5 py-1.5 text-left font-mono text-[11px] hover:bg-muted"
                    onClick={() => newQuery(sql)}
                  >
                    {sql}
                  </button>
                ))}
              </div>
            </section>
            {buckets.data?.[0] && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => openBucket(buckets.data[0].name)}
              >
                <ArchiveIcon className="size-3.5" />
                {buckets.data[0].name} öffnen
              </Button>
            )}
            <Link
              to="/connections"
              className="flex items-center justify-between rounded-xl border px-4 py-3 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              Verbindungen verwalten
              <ArrowRight className="size-3.5" />
            </Link>
          </aside>
        </div>
      </div>
      <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={openBucket} />
    </main>
  );
}
