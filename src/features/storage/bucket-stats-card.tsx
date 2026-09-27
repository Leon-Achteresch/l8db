import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/backup";
import { s3BucketStats } from "@/lib/db";
import { SettingsCard } from "./settings-card";
import { useStorageConnection } from "./use-storage-connection";

export function BucketStatsCard({ bucket }: { bucket: string }) {
  const { connection, url } = useStorageConnection();
  const stats = useQuery({
    queryKey: ["s3", connection?.id, "stats", bucket],
    queryFn: () => s3BucketStats(url, bucket),
    enabled: false,
  });
  const data = stats.data;
  return (
    <SettingsCard
      title="Belegung"
      description="Zählt alle Objekte des Buckets (aktuelle Versionen)."
      loading={stats.isFetching}
      error={stats.error}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void stats.refetch()}
          disabled={stats.isFetching}
        >
          {data ? "Neu berechnen" : "Berechnen"}
        </Button>
      }
    >
      {data ? (
        <div className="grid gap-2 text-sm">
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {data.objects.toLocaleString("de-DE")}
              </div>
              <div className="text-xs text-muted-foreground">
                Objekte{data.truncated ? " (gekappt)" : ""}
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{formatBytes(data.bytes)}</div>
              <div className="text-xs text-muted-foreground">Gesamtgröße</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {Object.entries(data.storage_classes).map(([name, bytes]) => (
              <span key={name}>
                {name}: {formatBytes(bytes)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}
