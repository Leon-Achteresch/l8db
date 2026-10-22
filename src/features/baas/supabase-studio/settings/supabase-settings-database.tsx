import { useQuery } from "@tanstack/react-query";
import { Copy, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";
import {
  type SupabaseProject,
  type SupabaseStudioCapabilities,
  supabaseDatabaseEndpoint,
} from "@/lib/db";
import { supabaseStudioSettingsPooler } from "@/lib/db/supabase-studio-settings";

interface Endpoint {
  label: string;
  host: string;
  port: number;
  user: string;
  database: string;
  detail?: string;
}

const connectionUri = (endpoint: Endpoint) =>
  `postgresql://${encodeURIComponent(endpoint.user)}:[PASSWORT]@${endpoint.host}:${endpoint.port}/${encodeURIComponent(endpoint.database)}`;

export function SupabaseSettingsDatabase({
  project,
  capabilities,
}: {
  project: SupabaseProject;
  capabilities: SupabaseStudioCapabilities;
}) {
  const endpoint = useQuery({
    queryKey: ["supabase", project.reference, "database-endpoint"],
    queryFn: () => supabaseDatabaseEndpoint(project.reference),
    enabled: project.self_hosted,
  });
  const pooler = useQuery({
    queryKey: ["supabase", project.reference, "studio-settings-pooler"],
    queryFn: () => supabaseStudioSettingsPooler(project.reference),
    enabled: capabilities.management,
  });
  const endpoints: Endpoint[] = project.self_hosted
    ? endpoint.data
      ? [{ label: "Pooler (Supavisor)", ...endpoint.data }]
      : []
    : [
        {
          label: "Direkt",
          host: project.database?.host ?? `db.${project.reference}.supabase.co`,
          port: 5432,
          user: "postgres",
          database: "postgres",
          detail: "IPv6, für langlebige Server",
        },
        ...(pooler.data ?? []).slice(0, 20).flatMap((entry) =>
          entry.db_host && entry.db_user && entry.db_port
            ? [
                {
                  label: `Pooler ${entry.pool_mode ?? ""}`.trim(),
                  host: entry.db_host,
                  port: entry.db_port,
                  user: entry.db_user,
                  database: entry.db_name ?? "postgres",
                  detail: [
                    entry.database_type,
                    entry.default_pool_size != null ? `Pool ${entry.default_pool_size}` : null,
                    entry.max_client_conn != null ? `max. ${entry.max_client_conn} Clients` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                },
              ]
            : [],
        ),
      ];
  const failure = endpoint.error ?? pooler.error;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Datenbankverbindung</h3>
      </div>
      <div className="mt-4 space-y-3">
        {endpoints.map((item) => (
          <div
            key={`${item.label}:${item.host}:${item.port}`}
            className="rounded-lg border bg-background/50 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {item.label}
                {item.detail && (
                  <span className="ml-2 font-normal text-muted-foreground">{item.detail}</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyWithToast(connectionUri(item), "Verbindungs-URI")}
              >
                <Copy className="size-3.5" /> URI kopieren
              </Button>
            </div>
            <dl className="mt-2 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">Host</dt>
              <dd className="truncate">{item.host}</dd>
              <dt className="text-muted-foreground">Port</dt>
              <dd>{item.port}</dd>
              <dt className="text-muted-foreground">Benutzer</dt>
              <dd className="truncate">{item.user}</dd>
              <dt className="text-muted-foreground">Datenbank</dt>
              <dd className="truncate">{item.database}</dd>
            </dl>
          </div>
        ))}
        {(endpoint.isFetching || pooler.isFetching) && (
          <p className="text-xs text-muted-foreground">Verbindungsdaten werden geladen…</p>
        )}
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {String(failure)}
          </p>
        )}
        {project.self_hosted && (
          <p className="text-[11px] text-muted-foreground">
            Selbst gehostet: Benutzer postgres.&lt;POOLER_TENANT_ID&gt;, Passwort POSTGRES_PASSWORD
            aus der .env der Instanz.
          </p>
        )}
      </div>
    </section>
  );
}
