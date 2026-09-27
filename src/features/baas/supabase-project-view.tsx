import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Database, ExternalLink, FunctionSquare, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import { type SupabaseProject, supabaseFunctions } from "@/lib/db";
import { activateConnectionWithToast } from "@/lib/ssh";
import { SupabaseAuthView } from "./supabase-auth-view";
import { SupabaseProjectKey } from "./supabase-project-key";
import { SupabaseServiceHealth } from "./supabase-service-health";
import { SupabaseStorageView } from "./supabase-storage-view";

export function SupabaseProjectView({ project }: { project: SupabaseProject }) {
  const navigate = useNavigate();
  const connections = useConnectionsStore((state) => state.connections);
  const functions = useQuery({
    queryKey: ["supabase", project.reference, "functions"],
    queryFn: () => supabaseFunctions(project.reference),
  });
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
      <SupabaseProjectKey reference={project.reference} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <SupabaseStorageView reference={project.reference} />
        <div className="space-y-6">
          <section className="min-w-0 rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <FunctionSquare className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Edge Functions</h3>
              {functions.data && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {functions.data.length}
                </span>
              )}
            </div>
            {functions.isPending ? (
              <p className="mt-5 text-xs text-muted-foreground">Wird geladen…</p>
            ) : functions.isError ? (
              <p role="alert" className="mt-5 text-xs text-destructive">
                {String(functions.error)}
              </p>
            ) : functions.data.length === 0 ? (
              <p className="mt-5 text-xs text-muted-foreground">Keine Edge Functions vorhanden.</p>
            ) : (
              <div className="mt-4 divide-y">
                {functions.data.map((item) => (
                  <div
                    key={item.slug}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium">
                        {item.name || item.slug}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {item.status ?? "Status unbekannt"}
                        {item.version == null ? "" : ` · v${item.version}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${item.slug} im Supabase-Dashboard öffnen`}
                      onClick={() =>
                        void openUrl(
                          `https://supabase.com/dashboard/project/${project.reference}/functions/${encodeURIComponent(item.slug)}`,
                        )
                      }
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <SupabaseAuthView reference={project.reference} />
        </div>
      </div>
    </div>
  );
}
