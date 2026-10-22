import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseBackupsView } from "../../supabase-backups-view";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseSettingsApi } from "./supabase-settings-api";
import { SupabaseSettingsDanger } from "./supabase-settings-danger";
import { SupabaseSettingsDataApi } from "./supabase-settings-data-api";
import { SupabaseSettingsDatabase } from "./supabase-settings-database";
import { SupabaseSettingsNetwork } from "./supabase-settings-network";
import { SupabaseSettingsPostgres } from "./supabase-settings-postgres";

export function SupabaseSettingsSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.studio.settings");

  return (
    <div className="space-y-6">
      <div ref={feature.ref} className="flex items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Einstellungen</h2>
        {feature.isNew && <NewBadge />}
      </div>
      <SupabaseSettingsApi project={project} capabilities={capabilities} />
      <SupabaseSettingsDatabase project={project} capabilities={capabilities} />
      {capabilities.management ? (
        <>
          <SupabaseSettingsDataApi reference={project.reference} />
          <SupabaseSettingsPostgres reference={project.reference} />
          <SupabaseSettingsNetwork reference={project.reference} />
          <SupabaseBackupsView reference={project.reference} />
        </>
      ) : (
        <p className="rounded-2xl border bg-card p-5 text-xs text-muted-foreground">
          Data-API-, Postgres-, Netzwerk- und Backup-Einstellungen gibt es nur für Supabase-Cloud-
          Projekte mit Zugangstoken. Selbst gehostet werden sie in der docker-compose.yml und .env
          der Instanz gepflegt.
        </p>
      )}
      <SupabaseSettingsDanger project={project} capabilities={capabilities} />
    </div>
  );
}
