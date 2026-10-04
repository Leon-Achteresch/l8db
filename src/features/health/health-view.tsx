import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, StethoscopeIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { type HealthCategory, runDatabaseHealthChecks } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";
import { HealthCheckItem } from "./health-check-item";
import {
  CATEGORY_LABEL,
  SEVERITY_CLASS,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  sortChecks,
} from "./health-meta";

const CATEGORIES: HealthCategory[] = ["security", "performance", "schema"];

export function HealthView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const [category, setCategory] = useState<HealthCategory | null>(null);
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
  const issues = visible.filter((check) => check.status === "issue");

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
      <div ref={ref} className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <StethoscopeIcon className="size-4 text-rose-500" />
        <span className="text-sm font-semibold">Health & Advisor</span>
        {isNew && <NewBadge />}
        {report.data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {checks.length} Prüfungen in {report.data.durationMs} ms
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void report.refetch()}
          disabled={report.isFetching}
        >
          {report.isFetching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Erneut prüfen
        </Button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        {SEVERITY_ORDER.map((severity) => (
          <span
            key={severity}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs tabular-nums",
              SEVERITY_CLASS[severity],
            )}
          >
            {SEVERITY_LABEL[severity]}:{" "}
            {issues.filter((check) => check.severity === severity).length}
          </span>
        ))}
        <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          Übersprungen: {visible.filter((check) => check.status === "skipped").length}
        </span>
        <span className="flex-1" />
        <Button
          variant={category === null ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setCategory(null)}
        >
          Alle
        </Button>
        {CATEGORIES.map((value) => (
          <Button
            key={value}
            variant={category === value ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setCategory(value)}
          >
            {CATEGORY_LABEL[value]}
          </Button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-4">
          {report.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Prüfungen laufen…
            </div>
          )}
          {report.isError && <p className="text-sm text-destructive">{String(report.error)}</p>}
          {visible.map((check) => (
            <HealthCheckItem key={check.id} check={check} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
