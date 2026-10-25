import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Database, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { supabaseStudioSettingsOverviewStats } from "@/lib/db/supabase-studio-settings";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { activateConnectionWithToast } from "@/lib/ssh";
import { SupabaseDatabaseConnectDialog } from "../../supabase-database-connect-dialog";
import { useSupabaseDatabase } from "../../use-supabase-database";
import { statusLabel } from "../supabase-services";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { useSupabaseHealth } from "../use-supabase-health";
import { SupabaseOverviewProtection } from "./supabase-overview-protection";
import { SupabaseSystemMap } from "./supabase-system-map";

const route = getRouteApi("/baas");

export function SupabaseOverviewSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.studio.overview");
  const apiUrl = project.self_hosted ? project.api_url : null;
  const cloudRef = apiUrl?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1];
  const database = useSupabaseDatabase(
    project.reference,
    apiUrl ? { url: apiUrl, name: project.name } : undefined,
  );
  const [connecting, setConnecting] = useState(false);
  const health = useSupabaseHealth(project.reference);
  const statsEnabled = capabilities.sql || capabilities.management;
  const stats = useQuery({
    queryKey: ["supabase", project.reference, "studio-overview-stats"],
    queryFn: () => supabaseStudioSettingsOverviewStats(project.reference),
    enabled: statsEnabled,
  });
  const keyType = capabilities.service_key
    ? "Secret Key"
    : capabilities.data_api
      ? "Publishable Key"
      : "Kein Projekt-Key";
  const errors = [
    ...(health.isError ? [String(health.error)] : []),
    ...(stats.isError ? [String(stats.error)] : []),
    ...(stats.data?.errors ?? []),
  ];

  async function openDatabase() {
    if (!database) return;
    if (await activateConnectionWithToast(database.id)) await navigate({ to: "/" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">
            {project.self_hosted
              ? "Selbst gehostet"
              : `Cloud · ${project.region ?? "Region unbekannt"}`}
          </p>
          <div ref={feature.ref} className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">{project.name}</h2>
            {!project.self_hosted && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {project.status ? statusLabel(project.status) : "Status unbekannt"}
              </span>
            )}
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{project.reference}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Übersicht aktualisieren"
            disabled={health.isFetching || stats.isFetching}
            onClick={() => {
              void health.refetch();
              if (statsEnabled) void stats.refetch();
              void queryClient.invalidateQueries({
                queryKey: ["supabase", project.reference, "studio-database", "rls_tables"],
              });
            }}
          >
            <RefreshCw
              className={`size-3.5 ${health.isFetching || stats.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openUrl(
                apiUrl && !cloudRef
                  ? apiUrl
                  : `https://supabase.com/dashboard/project/${cloudRef ?? project.reference}`,
              )
            }
          >
            {apiUrl && !cloudRef ? "Supabase Studio" : "Supabase-Dashboard"}
            <ExternalLink className="size-3.5" />
          </Button>
          <Button size="sm" onClick={() => (database ? void openDatabase() : setConnecting(true))}>
            <Database className="size-3.5" />
            {database ? `${database.name} öffnen` : "Datenbank verbinden"}
          </Button>
        </div>
      </header>

      <section className="rounded-2xl border bg-[radial-gradient(color-mix(in_oklch,var(--border)_70%,transparent)_0.8px,transparent_0.8px)] bg-size-[14px_14px] p-5">
        <SupabaseSystemMap
          project={project}
          capabilities={capabilities}
          health={health.data}
          stats={stats.data}
          keyType={keyType}
          onOpen={(id) => void navigate({ to: "/baas", search: { ...search, studio: id } })}
        />
        {!statsEnabled && (
          <p className="mt-4 text-xs text-muted-foreground">
            Kennzahlen benötigen SQL-Zugriff (Secret Key einer selbst gehosteten Instanz) oder einen
            Supabase-Zugangstoken.
          </p>
        )}
        {errors.map((error) => (
          <p key={error} role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ))}
      </section>

      {capabilities.sql && (
        <SupabaseOverviewProtection
          reference={project.reference}
          onOpen={() => void navigate({ to: "/baas", search: { ...search, studio: "policies" } })}
        />
      )}

      <SupabaseDatabaseConnectDialog
        reference={project.reference}
        name={project.name}
        apiUrl={apiUrl}
        open={connecting}
        onOpenChange={setConnecting}
      />
    </div>
  );
}
