import { Code2, Database, FolderOpen, Globe2, Network, Radio, Users } from "lucide-react";
import { formatBytes } from "@/lib/backup";
import type { SupabaseProject, SupabaseServiceHealth, SupabaseStudioCapabilities } from "@/lib/db";
import type { SupabaseSettingsOverviewStats } from "@/lib/db/supabase-studio-settings";
import { cn } from "@/lib/utils";
import { statusLabel } from "../supabase-services";
import {
  SUPABASE_STUDIO_SECTIONS,
  type SupabaseStudioSectionId,
} from "../supabase-studio-sections";
import { SupabaseSystemConnectors } from "./supabase-system-connectors";
import { SupabaseSystemNode } from "./supabase-system-node";

export function SupabaseSystemMap({
  project,
  capabilities,
  health,
  stats,
  keyType,
  onOpen,
}: {
  project: SupabaseProject;
  capabilities: SupabaseStudioCapabilities;
  health?: SupabaseServiceHealth[];
  stats?: SupabaseSettingsOverviewStats;
  keyType: string;
  onOpen: (section: SupabaseStudioSectionId) => void;
}) {
  const service = (name: string) => health?.find((entry) => entry.name === name);
  const reason = (id: SupabaseStudioSectionId) =>
    SUPABASE_STUDIO_SECTIONS.find((section) => section.id === id)?.unavailable(capabilities) ??
    null;
  const count = (value: number | null | undefined, unit: string) =>
    value == null
      ? undefined
      : `${value > (stats?.limit ?? Number.POSITIVE_INFINITY) ? `${(stats?.limit ?? 0).toLocaleString("de-DE")}+` : value.toLocaleString("de-DE")} ${unit}`;
  const services = [
    {
      id: "tables" as const,
      label: "Data API",
      icon: Network,
      health: service("rest"),
      metric: count(stats?.table_count, "Tab."),
    },
    {
      id: "auth" as const,
      label: "Auth",
      icon: Users,
      health: service("auth"),
      metric: count(stats?.auth_user_count, "Nutzer"),
    },
    {
      id: "storage" as const,
      label: "Storage",
      icon: FolderOpen,
      health: service("storage"),
      metric: count(stats?.bucket_count, "Buckets"),
    },
    {
      id: "realtime" as const,
      label: "Realtime",
      icon: Radio,
      health: service("realtime"),
      metric: undefined,
    },
    {
      id: "functions" as const,
      label: "Edge Functions",
      icon: Code2,
      health: undefined,
      metric: count(stats?.function_count, "Fn."),
    },
  ];
  const db = service("db");
  const pooler = service("pooler");
  const states = services.map((entry) => entry.health?.healthy);

  return (
    <figure aria-label="Systemkarte des Projekts" className="m-0">
      <div className="grid grid-cols-[minmax(150px,190px)_40px_minmax(230px,1fr)_40px_minmax(190px,250px)] items-stretch max-lg:grid-cols-1 max-lg:gap-3">
        <div className="flex flex-col justify-center">
          <div className="rounded-xl border border-dashed bg-background/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Globe2 className="size-3.5 text-muted-foreground" />
              Deine App
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Spricht über{" "}
              <span className="font-medium text-foreground">
                {project.self_hosted ? (project.api_url ?? "die API-URL") : "supabase.co"}
              </span>{" "}
              mit dem Projekt.
            </p>
            <p className="mt-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {keyType}
            </p>
          </div>
        </div>
        <div className="max-lg:hidden">
          <SupabaseSystemConnectors fromLeft states={states} />
        </div>
        <ul className="grid h-80 grid-rows-5 max-lg:h-auto max-lg:gap-2">
          {services.map((entry) => (
            <li key={entry.id} className="flex items-center py-1 max-lg:py-0">
              <SupabaseSystemNode
                icon={entry.icon}
                label={entry.label}
                metric={entry.metric}
                status={entry.health?.status}
                healthy={entry.health?.healthy}
                disabledReason={reason(entry.id)}
                onOpen={() => onOpen(entry.id)}
              />
            </li>
          ))}
        </ul>
        <div className="max-lg:hidden">
          <SupabaseSystemConnectors fromLeft={false} states={states} />
        </div>
        <div className="flex flex-col justify-center">
          <button
            type="button"
            onClick={() => onOpen("database")}
            disabled={Boolean(reason("database"))}
            title={reason("database") ?? undefined}
            className="group rounded-2xl border-2 border-primary/25 bg-primary/[0.045] p-4 text-left transition-colors enabled:hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4 text-primary" />
              PostgreSQL
              {db && (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    db.healthy ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
              )}
            </span>
            <span className="mt-3 block text-[11px] text-muted-foreground">Datenbankgröße</span>
            <span className="block text-2xl font-semibold tracking-tight tabular-nums">
              {formatBytes(stats?.database_size)}
            </span>
            <span className="mt-3 grid grid-cols-2 gap-2 border-t border-primary/15 pt-3 text-[11px]">
              <span>
                <span className="block text-muted-foreground">Version</span>
                <span className="font-medium">{project.database?.version ?? "–"}</span>
              </span>
              <span>
                <span className="block text-muted-foreground">Pooler</span>
                <span className="flex items-center gap-1 font-medium">
                  {pooler && (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        pooler.healthy ? "bg-emerald-500" : "bg-amber-500",
                      )}
                    />
                  )}
                  {pooler ? statusLabel(pooler.status) : "–"}
                </span>
              </span>
            </span>
            {db && (
              <span className="mt-2 block text-[11px] text-muted-foreground">
                {statusLabel(db.status)}
              </span>
            )}
          </button>
        </div>
      </div>
    </figure>
  );
}
