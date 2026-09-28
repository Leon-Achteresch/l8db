import { useVirtualizer } from "@tanstack/react-virtual";
import { Database } from "lucide-react";
import { useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import { useDbSelectionStore } from "@/lib/db-selection";
import type { useDatabaseOverviewQuery } from "@/lib/queries";

const SCHEMA_ROW_HEIGHT = 48;
const SCHEMA_LIST_HEIGHT = 384;
const EMPTY_SCHEMAS: NonNullable<ReturnType<typeof useDatabaseOverviewQuery>["data"]>["schemas"] =
  [];

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
  const schemas = overview.data?.schemas ?? EMPTY_SCHEMAS;
  const scrollRef = useRef<HTMLElement>(null);
  const getItemKey = useCallback((index: number) => schemas[index].schema, [schemas]);
  const virtualizer = useVirtualizer({
    count: schemas.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SCHEMA_ROW_HEIGHT,
    getItemKey,
    overscan: 4,
    initialRect: { width: 300, height: SCHEMA_LIST_HEIGHT },
  });

  const focusSchema = (index: number) => {
    virtualizer.scrollToIndex(index, { align: "auto" });
    const focus = (remaining: number) => {
      const button = scrollRef.current?.querySelector<HTMLButtonElement>(
        `[data-index="${index}"] button`,
      );
      if (button) button.focus();
      else if (remaining > 0) requestAnimationFrame(() => focus(remaining - 1));
    };
    requestAnimationFrame(() => focus(5));
  };

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
            <section
              ref={scrollRef}
              aria-label="Schemas"
              className="mt-5 overflow-y-auto"
              style={{ height: Math.min(SCHEMA_LIST_HEIGHT, virtualizer.getTotalSize()) }}
            >
              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((row) => {
                  const entry = schemas[row.index];
                  return (
                    <div
                      key={row.key}
                      data-index={row.index}
                      className="absolute left-0 w-full"
                      style={{ top: row.start, height: row.size }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          useDbSelectionStore.getState().setSchema(connectionId, entry.schema)
                        }
                        onKeyDown={(event) => {
                          const next =
                            event.key === "ArrowDown"
                              ? Math.min(row.index + 1, schemas.length - 1)
                              : event.key === "ArrowUp"
                                ? Math.max(row.index - 1, 0)
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? schemas.length - 1
                                    : null;
                          if (next === null) return;
                          event.preventDefault();
                          focusSchema(next);
                        }}
                        aria-current={schema === entry.schema ? "true" : undefined}
                        className="flex h-full w-full flex-col justify-center rounded-lg p-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span className="mb-1.5 flex w-full items-center justify-between text-xs">
                          <span
                            className={
                              schema === entry.schema ? "font-mono text-primary" : "font-mono"
                            }
                          >
                            {entry.schema}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {entry.table_count} Tabellen · {formatBytes(entry.size_bytes)}
                          </span>
                        </span>
                        <span className="block h-1 w-full overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary/60"
                            style={{
                              width: `${Math.max(1, (entry.size_bytes / largestSchema) * 100)}%`,
                            }}
                          />
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )
      )}
    </section>
  );
}
