import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { convexDashboardUrl, useConvexSettingsInfo } from "../settings/use-convex-settings-info";
import { ConvexOverviewErrors } from "./convex-overview-errors";
import { ConvexOverviewStats } from "./convex-overview-stats";

export function ConvexOverviewSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.studio.overview");
  const info = useConvexSettingsInfo(deployment);
  const dashboard = convexDashboardUrl(deployment);
  const state = info.data?.state;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div ref={feature.ref} className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">{deployment.title}</h2>
            {state && (
              <span
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${state === "running" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {state === "running" ? "Läuft" : state === "paused" ? "Pausiert" : state}
              </span>
            )}
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {info.data?.url ?? deployment.url ?? deployment.deploymentName}
            {info.data?.version && ` · v${info.data.version}`}
          </p>
        </div>
        {dashboard && (
          <Button variant="outline" size="sm" onClick={() => void openUrl(dashboard)}>
            Convex-Dashboard <ExternalLink className="size-3.5" />
          </Button>
        )}
      </header>
      {info.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(info.error)}
        </p>
      )}
      <ConvexOverviewStats deployment={deployment} />
      <ConvexOverviewErrors deployment={deployment} />
    </div>
  );
}
