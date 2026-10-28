import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Activity, ExternalLink, Globe2, Server } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { CONVEX_STUDIO_SECTIONS, type ConvexStudioSectionProps } from "../convex-studio-sections";
import { convexDashboardUrl, useConvexSettingsInfo } from "../settings/use-convex-settings-info";
import { ConvexOverviewErrors } from "./convex-overview-errors";
import { ConvexOverviewStats } from "./convex-overview-stats";

const route = getRouteApi("/baas");

export function ConvexOverviewSection({ deployment }: ConvexStudioSectionProps) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.studio.overview");
  const info = useConvexSettingsInfo(deployment);
  const dashboard = convexDashboardUrl(deployment);
  const state = info.data?.state;
  const links = CONVEX_STUDIO_SECTIONS.filter((section) => section.id !== "overview");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div ref={feature.ref} className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{deployment.title}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {deployment.selfHosted ? "Selbst gehostet" : "Convex Cloud"}
              </span>
              {state && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${state === "running" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}
                >
                  {state === "running" ? "Läuft" : state === "paused" ? "Pausiert" : state}
                </span>
              )}
              {feature.isNew && <NewBadge />}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {info.data?.url ?? deployment.url ?? deployment.deploymentName}
            </p>
          </div>
          {dashboard && (
            <Button variant="outline" size="sm" onClick={() => void openUrl(dashboard)}>
              Convex-Dashboard <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
        {info.isError && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {String(info.error)}
          </p>
        )}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Server, label: "Backend-Version", value: info.data?.version },
            { icon: Globe2, label: "HTTP-Actions", value: info.data?.siteUrl },
            {
              icon: Activity,
              label: "Instanz",
              value: info.data?.instanceName ?? info.data?.kind,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <item.icon className="size-3.5" /> {item.label}
              </div>
              <p className="mt-2 truncate text-sm font-medium" title={item.value ?? undefined}>
                {info.isPending ? "…" : (item.value ?? "Unbekannt")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <ConvexOverviewStats deployment={deployment} />
      <ConvexOverviewErrors deployment={deployment} />

      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Schnellzugriff</h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() =>
                void navigate({ to: "/baas", search: { ...search, studio: section.id } })
              }
              className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <section.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{section.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
