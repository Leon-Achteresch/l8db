import { useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Database, ExternalLink, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import type { SupabaseProject } from "@/lib/db";
import { activateConnectionWithToast } from "@/lib/ssh";
import { SupabaseAuthView } from "./supabase-auth-view";
import { SupabaseDatabaseView } from "./supabase-database-view";
import { SupabaseFunctionsView } from "./supabase-functions-view";
import { SupabaseProjectKey } from "./supabase-project-key";
import { SupabaseServiceHealth } from "./supabase-service-health";
import { SupabaseStorageView } from "./supabase-storage-view";

export function SupabaseProjectView({ project }: { project: SupabaseProject }) {
  const navigate = useNavigate();
  const connections = useConnectionsStore((state) => state.connections);
  const database = connections.find((connection) => {
    if (providerFor(connection).id !== "supabase") return false;
    try {
      const url = new URL(connection.connectionString);
      return (
        url.hostname === `db.${project.reference}.supabase.co` ||
        decodeURIComponent(url.username).endsWith(`.${project.reference}`)
      );
    } catch {
      return false;
    }
  });

  async function openDatabase() {
    if (!database) return;
    if (await activateConnectionWithToast(database.id)) await navigate({ to: "/" });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{project.name}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {project.status ?? "Status unbekannt"}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.reference}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openUrl(`https://supabase.com/dashboard/project/${project.reference}`)
            }
          >
            Supabase-Dashboard <ExternalLink className="size-3.5" />
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe2 className="size-3.5" /> Region
            </div>
            <p className="mt-2 text-sm font-medium">{project.region ?? "Unbekannt"}</p>
          </div>
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="size-3.5" /> PostgreSQL
            </div>
            <p className="mt-2 truncate text-sm font-medium">
              {project.database?.version ?? "Version unbekannt"}
            </p>
          </div>
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowUpRight className="size-3.5" /> Datenbank in l8db
            </div>
            {database ? (
              <button
                type="button"
                className="mt-2 text-left text-sm font-medium text-primary hover:underline"
                onClick={() => void openDatabase()}
              >
                {database.name} öffnen
              </button>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Noch nicht verbunden</p>
            )}
          </div>
        </div>
      </section>

      <SupabaseServiceHealth reference={project.reference} />
      <SupabaseProjectKey key={project.reference} reference={project.reference} />
      <SupabaseDatabaseView key={project.reference} reference={project.reference} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <SupabaseStorageView key={project.reference} reference={project.reference} />
        <div className="space-y-6">
          <SupabaseFunctionsView key={project.reference} reference={project.reference} />
          <SupabaseAuthView key={project.reference} reference={project.reference} />
        </div>
      </div>
    </div>
  );
}
