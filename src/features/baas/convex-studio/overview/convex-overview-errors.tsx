import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, RefreshCw } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { convexStudioSettingsRecentErrors } from "@/lib/db/convex-studio-settings";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { formatRelative } from "../schedules/convex-schedules-format";
import { convexSettingsKey } from "../settings/use-convex-settings-info";
import { groupRecentErrors } from "./convex-overview-insights";

const route = getRouteApi("/baas");

export function ConvexOverviewErrors({ deployment }: { deployment: ConvexStudioDeployment }) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("baas.convex.studio.overview.insights");
  const errors = useQuery({
    queryKey: convexSettingsKey(deployment, "recent-errors"),
    queryFn: () => convexStudioSettingsRecentErrors(deployment),
  });
  const insights = groupRecentErrors(errors.data ?? []);
  const openLogs = (logFunction?: string) =>
    void navigate({ to: "/baas", search: { ...search, studio: "logs", logFunction } });

  return (
    <section ref={feature.ref} aria-label="Auffälligkeiten">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          Auffälligkeiten
          {insights.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {insights.length}
            </span>
          )}
          {feature.isNew && <NewBadge className="ml-2" />}
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => openLogs()}>
            Alle Logs
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Auffälligkeiten aktualisieren"
            onClick={() => void errors.refetch()}
            disabled={errors.isFetching}
          >
            <RefreshCw className={`size-3.5 ${errors.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {errors.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(errors.error)}
        </p>
      ) : errors.isPending ? null : insights.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
          <CircleCheck className="size-3.5 text-emerald-500" /> Keine Fehler im Log-Puffer
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {insights.map((insight) => (
            <li key={`${insight.identifier}\n${insight.message}`}>
              <button
                type="button"
                onClick={() => openLogs(insight.identifier || undefined)}
                className="group flex w-full items-center gap-3 rounded-xl bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted active:bg-muted/70"
              >
                <span className="w-9 shrink-0 rounded-full bg-destructive/10 py-0.5 text-center text-[11px] font-medium text-destructive tabular-nums">
                  {insight.count}×
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono font-medium">
                      {insight.identifier || "Unbekannt"}
                    </span>
                    {insight.udfType && (
                      <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                        {insight.udfType}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-destructive">
                    {insight.message}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatRelative(insight.last * 1000)}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
