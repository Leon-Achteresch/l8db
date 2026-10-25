import {
  Archive,
  Database,
  KeyRound,
  Network,
  Server,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSidebarItem } from "../../baas-sidebar-item";
import { BaasSidebarPortal } from "../../baas-sidebar-portal";
import { SupabaseBackupsView } from "../../supabase-backups-view";
import { SupabaseSectionHeader } from "../supabase-section-header";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseSettingsApi } from "./supabase-settings-api";
import { SupabaseSettingsDanger } from "./supabase-settings-danger";
import { SupabaseSettingsDataApi } from "./supabase-settings-data-api";
import { SupabaseSettingsDatabase } from "./supabase-settings-database";
import { SupabaseSettingsNetwork } from "./supabase-settings-network";
import { SupabaseSettingsPostgres } from "./supabase-settings-postgres";

export function SupabaseSettingsSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.settings");
  const managed = capabilities.management;
  const parts = [
    { id: "supabase-settings-api", label: "API-Schlüssel", icon: KeyRound, show: true },
    { id: "supabase-settings-database", label: "Datenbankzugang", icon: Database, show: true },
    { id: "supabase-settings-data-api", label: "Data API", icon: SlidersHorizontal, show: managed },
    { id: "supabase-settings-postgres", label: "Postgres", icon: Server, show: managed },
    { id: "supabase-settings-network", label: "Netzwerk", icon: Network, show: managed },
    { id: "supabase-settings-backups", label: "Backups", icon: Archive, show: managed },
    { id: "supabase-settings-danger", label: "Gefahrenzone", icon: ShieldAlert, show: true },
  ].filter((part) => part.show);

  return (
    <div className="space-y-6 [&_[id^=supabase-settings-]]:scroll-mt-4">
      <BaasSidebarPortal>
        <nav aria-label="Einstellungen" className="grid gap-0.5">
          {parts.map((part) => (
            <BaasSidebarItem
              key={part.id}
              icon={part.icon}
              active={false}
              onClick={() =>
                document
                  .getElementById(part.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {part.label}
            </BaasSidebarItem>
          ))}
        </nav>
      </BaasSidebarPortal>
      <SupabaseSectionHeader
        title="Einstellungen"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="API-Schlüssel, Datenbankzugang, Netzwerk, Backups und Projektsteuerung."
      />
      <div id="supabase-settings-api">
        <SupabaseSettingsApi project={project} capabilities={capabilities} />
      </div>
      <div id="supabase-settings-database">
        <SupabaseSettingsDatabase project={project} capabilities={capabilities} />
      </div>
      {managed ? (
        <>
          <div id="supabase-settings-data-api">
            <SupabaseSettingsDataApi reference={project.reference} />
          </div>
          <div id="supabase-settings-postgres">
            <SupabaseSettingsPostgres reference={project.reference} />
          </div>
          <div id="supabase-settings-network">
            <SupabaseSettingsNetwork reference={project.reference} />
          </div>
          <div id="supabase-settings-backups">
            <SupabaseBackupsView reference={project.reference} />
          </div>
        </>
      ) : (
        <p className="rounded-2xl border bg-card p-5 text-xs text-muted-foreground">
          Data-API-, Postgres-, Netzwerk- und Backup-Einstellungen gibt es nur für Supabase-Cloud-
          Projekte mit Zugangstoken. Selbst gehostet werden sie in der docker-compose.yml und .env
          der Instanz gepflegt.
        </p>
      )}
      <div id="supabase-settings-danger">
        <SupabaseSettingsDanger project={project} capabilities={capabilities} />
      </div>
    </div>
  );
}
