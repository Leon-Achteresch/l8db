import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { convexStudioSettingsRecentErrors } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { convexSettingsKey } from "../settings/use-convex-settings-info";

const route = getRouteApi("/baas");

export function ConvexOverviewErrors({ deployment }: { deployment: ConvexStudioDeployment }) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const errors = useQuery({
    queryKey: convexSettingsKey(deployment, "recent-errors"),
    queryFn: () => convexStudioSettingsRecentErrors(deployment),
  });

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Letzte Fehler</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: "/baas", search: { ...search, studio: "logs" } })}
          >
            Alle Logs
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fehler aktualisieren"
            onClick={() => void errors.refetch()}
            disabled={errors.isFetching}
          >
            <RefreshCw className={`size-3.5 ${errors.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {errors.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Fehler werden geladen…</p>
      ) : errors.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(errors.error)}
        </p>
      ) : errors.data.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Keine Fehler im aktuellen Log-Puffer des Deployments.
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border bg-background/50">
          {errors.data.map((error) => (
            <li
              key={`${error.requestId ?? ""}:${error.timestamp}:${error.identifier}`}
              className="px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{error.identifier || "Unbekannt"}</span>
                {error.udfType && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {error.udfType}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                  {new Date(error.timestamp * 1000).toLocaleString("de-DE")}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 font-mono text-[11px] whitespace-pre-wrap text-destructive">
                {error.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
