import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { convexStudioSettingsStats } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment, ConvexStudioSectionId } from "../convex-studio-sections";
import { convexSettingsKey } from "../settings/use-convex-settings-info";

const route = getRouteApi("/baas");

export function ConvexOverviewStats({ deployment }: { deployment: ConvexStudioDeployment }) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const stats = useQuery({
    queryKey: convexSettingsKey(deployment, "stats"),
    queryFn: () => convexStudioSettingsStats(deployment),
  });
  const count = (value: number | null | undefined, more = false) =>
    value == null ? "–" : `${value.toLocaleString("de-DE")}${more ? "+" : ""}`;
  const data = stats.data;
  const cards: { label: string; value: string; section: ConvexStudioSectionId }[] = [
    { label: "Tabellen", value: count(data?.tableCount), section: "data" },
    { label: "Dokumente", value: count(data?.documentCount), section: "data" },
    { label: "Funktionen", value: count(data?.functionCount), section: "functions" },
    { label: "HTTP-Routen", value: count(data?.httpRouteCount), section: "functions" },
    { label: "Dateien", value: count(data?.fileCount), section: "files" },
    {
      label: "Geplant",
      value: count(data?.scheduledPending, data?.scheduledHasMore),
      section: "schedules",
    },
    { label: "Cronjobs", value: count(data?.cronCount), section: "schedules" },
  ];

  if (stats.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(stats.error)}
      </p>
    );

  return (
    <section aria-label="Kennzahlen">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() =>
              void navigate({ to: "/baas", search: { ...search, studio: card.section } })
            }
            className="rounded-xl bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted/70"
          >
            <span className="block truncate text-[11px] text-muted-foreground">{card.label}</span>
            <span className="mt-1 block text-xl font-medium tabular-nums">
              {stats.isPending ? "…" : card.value}
            </span>
          </button>
        ))}
      </div>
      {data?.errors.map((error) => (
        <p key={error} role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ))}
    </section>
  );
}
