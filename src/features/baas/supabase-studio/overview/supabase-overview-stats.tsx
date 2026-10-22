import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/backup";
import type { SupabaseStudioCapabilities } from "@/lib/db";
import { supabaseStudioSettingsOverviewStats } from "@/lib/db/supabase-studio-settings";

export function SupabaseOverviewStats({
  reference,
  capabilities,
}: {
  reference: string;
  capabilities: SupabaseStudioCapabilities;
}) {
  const enabled = capabilities.sql || capabilities.management;
  const stats = useQuery({
    queryKey: ["supabase", reference, "studio-overview-stats"],
    queryFn: () => supabaseStudioSettingsOverviewStats(reference),
    enabled,
  });
  const count = (value: number | null | undefined) =>
    value == null
      ? "–"
      : value > (stats.data?.limit ?? Number.POSITIVE_INFINITY)
        ? `${(stats.data?.limit ?? 0).toLocaleString("de-DE")}+`
        : value.toLocaleString("de-DE");
  const cards = [
    {
      label: "Datenbankgröße",
      value: formatBytes(stats.data?.database_size),
      show: capabilities.sql,
    },
    { label: "Tabellen", value: count(stats.data?.table_count), show: capabilities.sql },
    { label: "Auth-Benutzer", value: count(stats.data?.auth_user_count), show: capabilities.sql },
    { label: "Buckets", value: count(stats.data?.bucket_count), show: capabilities.sql },
    {
      label: "Edge Functions",
      value: count(stats.data?.function_count),
      show: capabilities.management,
    },
  ].filter((card) => card.show);

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Kennzahlen</h3>
        {enabled && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Kennzahlen aktualisieren"
            onClick={() => void stats.refetch()}
            disabled={stats.isFetching}
          >
            <RefreshCw className={`size-3.5 ${stats.isFetching ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>
      {!enabled ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Kennzahlen benötigen SQL-Zugriff (Secret Key einer selbst gehosteten Instanz) oder einen
          Supabase-Zugangstoken.
        </p>
      ) : stats.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(stats.error)}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((card) => (
              <div key={card.label} className="rounded-lg border bg-background/50 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{card.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {stats.isPending ? "…" : card.value}
                </p>
              </div>
            ))}
          </div>
          {stats.data?.errors.map((error) => (
            <p key={error} role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
