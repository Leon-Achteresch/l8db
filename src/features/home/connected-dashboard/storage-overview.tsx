import { Database } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import { useDbSelectionStore } from "@/lib/db-selection";
import type { useDatabaseOverviewQuery } from "@/lib/queries";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** index).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}

interface StorageOverviewProps {
  overview: ReturnType<typeof useDatabaseOverviewQuery>;
  schema: string;
  connectionId: string;
  largestSchema: number;
}

export function StorageOverview({
  overview,
  schema,
  connectionId,
  largestSchema,
}: StorageOverviewProps) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Speicher & Schemas</h2>
        <Database className="size-4 text-muted-foreground" />
      </div>
      {overview.isPending || (overview.isError && !queryErrorMessage(overview.error)) ? (
        <Skeleton className="my-5 h-12 w-28" />
      ) : overview.isError ? (
        <p role="alert" className="mt-4 text-xs leading-relaxed text-destructive">
          {queryErrorMessage(overview.error)}
        </p>
      ) : (
        overview.data && (
          <>
            <p className="mt-4 text-3xl font-medium tracking-tight">{overview.data.size_pretty}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Gesamtgröße von {overview.data.database}
            </p>
            <div className="mt-5 space-y-3">
              {overview.data.schemas.map((entry) => (
                <button
                  key={entry.schema}
                  type="button"
                  onClick={() =>
                    useDbSelectionStore.getState().setSchema(connectionId, entry.schema)
                  }
                  className="block w-full rounded-lg p-1 text-left hover:bg-muted"
                >
                  <span className="mb-1.5 flex items-center justify-between text-xs">
                    <span
                      className={schema === entry.schema ? "font-mono text-primary" : "font-mono"}
                    >
                      {entry.schema}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {entry.table_count} Tabellen · {formatBytes(entry.size_bytes)}
                    </span>
                  </span>
                  <span className="block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/60"
                      style={{
                        width: `${Math.max(1, (entry.size_bytes / largestSchema) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              ))}
            </div>
          </>
        )
      )}
    </section>
  );
}
