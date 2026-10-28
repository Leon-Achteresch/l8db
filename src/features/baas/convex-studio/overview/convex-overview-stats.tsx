import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { convexStudioSettingsStats } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { convexSettingsKey } from "../settings/use-convex-settings-info";

export function ConvexOverviewStats({ deployment }: { deployment: ConvexStudioDeployment }) {
  const stats = useQuery({
    queryKey: convexSettingsKey(deployment, "stats"),
    queryFn: () => convexStudioSettingsStats(deployment),
  });
  const count = (value: number | null | undefined, more = false) =>
    value == null ? "–" : `${value.toLocaleString("de-DE")}${more ? "+" : ""}`;
  const data = stats.data;
  const cards = [
    { label: "Tabellen", value: count(data?.tableCount) },
    { label: "Dokumente", value: count(data?.documentCount) },
    { label: "Funktionen", value: count(data?.functionCount) },
    { label: "HTTP-Routen", value: count(data?.httpRouteCount) },
    { label: "Dateien", value: count(data?.fileCount) },
    {
      label: "Geplant (ausstehend)",
      value: count(data?.scheduledPending, data?.scheduledHasMore),
    },
    { label: "Cronjobs", value: count(data?.cronCount) },
  ];

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Kennzahlen</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Kennzahlen aktualisieren"
          onClick={() => void stats.refetch()}
          disabled={stats.isFetching}
        >
          <RefreshCw className={`size-3.5 ${stats.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {stats.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(stats.error)}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {cards.map((card) => (
              <div key={card.label} className="rounded-lg border bg-background/50 px-3 py-2">
                <p className="truncate text-[11px] text-muted-foreground">{card.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {stats.isPending ? "…" : card.value}
                </p>
              </div>
            ))}
          </div>
          {data?.errors.map((error) => (
            <p key={error} role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
