import { useQuery } from "@tanstack/react-query";
import { ArchiveRestore, RefreshCw } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { supabaseBackups } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function formatDate(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

function formatUnixDate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Nicht angegeben";
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("de-DE") : "Nicht angegeben";
}

export function SupabaseBackupsView({ reference }: { reference: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.backups");
  const backups = useQuery({
    queryKey: ["supabase", reference, "backups"],
    queryFn: () => supabaseBackups(reference),
  });
  const recovery = backups.data?.physical_backup_data;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <ArchiveRestore className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Datenbank-Backups</h3>
          {feature.isNew && <NewBadge />}
          {backups.data && (
            <span className="text-xs text-muted-foreground">{backups.data.backups.length}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Datenbank-Backups aktualisieren"
          onClick={() => void backups.refetch()}
          disabled={backups.isFetching}
        >
          <RefreshCw className={`size-3.5 ${backups.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Benötigt Backups: Read. Storage-Dateien sind in Datenbank-Backups nicht enthalten.
      </p>
      {backups.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Backups werden geladen…</p>
      ) : backups.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(backups.error)}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <div className="rounded-lg border bg-background/50 px-3 py-2">
              <span className="text-muted-foreground">Point-in-Time Recovery: </span>
              <span className="font-medium">
                {backups.data.pitr_enabled == null
                  ? "Nicht angegeben"
                  : backups.data.pitr_enabled
                    ? "Aktiv"
                    : "Inaktiv"}
              </span>
            </div>
            {recovery && (
              <div className="rounded-lg border bg-background/50 px-3 py-2">
                <span className="text-muted-foreground">Wiederherstellungszeitraum: </span>
                <span className="font-medium">
                  {formatUnixDate(recovery.earliest_physical_backup_date_unix)} –{" "}
                  {formatUnixDate(recovery.latest_physical_backup_date_unix)}
                </span>
              </div>
            )}
          </div>
          {backups.data.backups.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Keine Backups verfügbar.</p>
          ) : (
            <div className="mt-4 max-h-64 divide-y overflow-auto rounded-lg border px-3">
              {backups.data.backups.map((backup, index) => (
                <div
                  key={backup.id ?? `${backup.inserted_at ?? "backup"}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div>
                    <p className="font-medium">{formatDate(backup.inserted_at)}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {backup.is_physical_backup == null
                        ? "Backup-Typ unbekannt"
                        : backup.is_physical_backup
                          ? "Physisches Backup"
                          : "Logisches Backup"}
                    </p>
                  </div>
                  <span className="text-muted-foreground">
                    {backup.status ?? "Status unbekannt"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
