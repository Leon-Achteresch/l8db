import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Database, ExternalLink, Globe2, KeyRound } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { activateConnectionWithToast } from "@/lib/ssh";
import { SupabaseDatabaseConnectDialog } from "../../supabase-database-connect-dialog";
import { SupabaseServiceHealth } from "../../supabase-service-health";
import { useSupabaseDatabase } from "../../use-supabase-database";
import {
  SUPABASE_STUDIO_SECTIONS,
  type SupabaseStudioSectionProps,
} from "../supabase-studio-sections";
import { SupabaseOverviewStats } from "./supabase-overview-stats";

const route = getRouteApi("/baas");

export function SupabaseOverviewSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.studio.overview");
  const apiUrl = project.self_hosted ? project.api_url : null;
  const cloudRef = apiUrl?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1];
  const database = useSupabaseDatabase(
    project.reference,
    apiUrl ? { url: apiUrl, name: project.name } : undefined,
  );
  const [connecting, setConnecting] = useState(false);
  const keyType = capabilities.service_key
    ? "Secret Key"
    : capabilities.data_api
      ? "Publishable Key"
      : "Kein Projekt-Key";
  const links = SUPABASE_STUDIO_SECTIONS.filter(
    (section) => section.id !== "overview" && !section.unavailable(capabilities),
  );

  async function openDatabase() {
    if (!database) return;
    if (await activateConnectionWithToast(database.id)) await navigate({ to: "/" });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div ref={feature.ref} className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{project.name}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {project.self_hosted ? "Selbst gehostet" : (project.status ?? "Status unbekannt")}
              </span>
              {feature.isNew && <NewBadge />}
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.reference}</p>
          </div>
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
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe2 className="size-3.5" /> {apiUrl ? "API-URL" : "Region"}
            </div>
            <p className="mt-2 truncate text-sm font-medium" title={apiUrl ?? undefined}>
              {apiUrl ?? project.region ?? "Unbekannt"}
            </p>
          </div>
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" /> Zugriff
            </div>
            <p className="mt-2 truncate text-sm font-medium">
              {keyType}
              {capabilities.management ? " · Zugangstoken" : ""}
            </p>
          </div>
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="size-3.5" /> Datenbank in l8db
            </div>
            <button
              type="button"
              className="mt-2 text-left text-sm font-medium text-primary hover:underline"
              onClick={() => (database ? void openDatabase() : setConnecting(true))}
            >
              {database ? `${database.name} öffnen` : "Datenbank verbinden"}
            </button>
          </div>
        </div>
      </section>

      <SupabaseDatabaseConnectDialog
        reference={project.reference}
        name={project.name}
        apiUrl={apiUrl}
        open={connecting}
        onOpenChange={setConnecting}
      />
      <SupabaseServiceHealth reference={project.reference} />
      <SupabaseOverviewStats reference={project.reference} capabilities={capabilities} />

      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Schnellzugriff</h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() =>
                  void navigate({ to: "/baas", search: { ...search, studio: section.id } })
                }
                className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
