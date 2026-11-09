import { useQuery } from "@tanstack/react-query";
import { CircleCheckIcon, RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { type HealthCategory, runDatabaseHealthChecks } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { effectiveConnectionString } from "@/lib/ssh";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { cn } from "@/lib/utils";
import { HealthCheckItem } from "./health-check-item";
import {
  CATEGORY_LABEL,
  GROUP_DOT,
  GROUP_LABEL,
  GROUP_ORDER,
  groupOf,
  sortChecks,
} from "./health-meta";

const CATEGORIES: HealthCategory[] = ["security", "performance", "schema"];

export function HealthView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const [category, setCategory] = useTabState<HealthCategory | null>(
    tabStateKey(`tool:health:${connection?.id ?? ""}`, "category"),
    null,
  );
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("health.advisor");
  const report = useQuery({
    queryKey: ["health-checks", connection?.id, database],
    queryFn: () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return runDatabaseHealthChecks(
        connection.kind,
        effectiveConnectionString(connection),
        database ?? undefined,
      );
    },
    enabled: Boolean(connection) && caps.health_advisor,
    staleTime: 60_000,
  });
  const checks = useMemo(() => sortChecks(report.data?.checks ?? []), [report.data]);
  const visible = category ? checks.filter((check) => check.category === category) : checks;
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: visible.filter((check) => groupOf(check) === group),
  }));

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }
  if (!caps.health_advisor) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Health-Checks werden für diese Verbindung nicht unterstützt.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={ref}
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3"
      >
        <h1 className="text-sm font-semibold">Health & Advisor</h1>
        {isNew && <NewBadge />}
        {report.data && (
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase tabular-nums">
            {checks.length} Prüfungen · {report.data.durationMs} ms
          </span>
        )}
        <span className="flex-1" />
        <div className="flex items-center rounded-full bg-muted/60 p-0.5">
          {[null, ...CATEGORIES].map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={cn(
                "h-6 cursor-pointer rounded-full px-2.5 text-xs transition-colors",
                category === value
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value ? CATEGORY_LABEL[value] : "Alle"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Erneut prüfen"
          title="Erneut prüfen"
          onClick={() => void report.refetch()}
          disabled={report.isFetching}
        >
          {report.isFetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
      {report.isSuccess && visible.length > 0 && (
        <div className="shrink-0 px-5 pb-4">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {groups.map(({ group, items }) => (
              <div key={group} className="min-w-20">
                <div
                  className={cn(
                    "text-2xl font-medium tabular-nums",
                    items.length === 0 && "text-muted-foreground/40",
                  )}
                >
                  {items.length}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", GROUP_DOT[group])} />
                  {GROUP_LABEL[group]}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex h-1.5 gap-0.5">
            {groups.map(
              ({ group, items }) =>
                items.length > 0 && (
                  <span
                    key={group}
                    style={{ flexGrow: items.length }}
                    className={cn(
                      "basis-0 rounded-[3px]",
                      GROUP_DOT[group],
                      group === "ok" && "opacity-40",
                    )}
                  />
                ),
            )}
          </div>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pb-4">
          {report.isLoading && (
            <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
              <Spinner />
              Prüfungen laufen…
            </div>
          )}
          {report.isError && (
            <p className="px-2 text-sm text-destructive">{String(report.error)}</p>
          )}
          {report.isSuccess && visible.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleCheckIcon />
                </EmptyMedia>
                <EmptyTitle>Keine Prüfergebnisse</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {groups.map(
            ({ group, items }) =>
              items.length > 0 && (
                <section key={group}>
                  <h2 className="flex items-center gap-2 px-2 pb-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                    {GROUP_LABEL[group]}
                    <span className="tabular-nums opacity-60">{items.length}</span>
                  </h2>
                  {items.map((check) => (
                    <HealthCheckItem key={check.id} check={check} />
                  ))}
                </section>
              ),
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
