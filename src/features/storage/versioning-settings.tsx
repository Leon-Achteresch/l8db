import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseVersioning, versioningXml } from "@/lib/storage/s3";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

export function VersioningSettings({ bucket }: { bucket: string }) {
  const config = useBucketConfig(bucket, "versioning");
  const status = parseVersioning(config.data);
  const label = { Enabled: "Aktiv", Suspended: "Pausiert", Off: "Aus", Unknown: "Unbekannt" }[
    status
  ];
  return (
    <SettingsCard
      title="Versionierung"
      description="Bewahrt jede Überschreibung und Löschung als eigene Version auf."
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
    >
      <div className="flex items-center gap-2">
        <Badge variant={status === "Enabled" ? "default" : "secondary"}>{label}</Badge>
        {!config.readOnly && (
          <Button
            size="sm"
            variant="outline"
            disabled={config.busy}
            title={
              status === "Enabled"
                ? "Neue Änderungen überschreiben direkt, vorhandene Versionen bleiben erhalten."
                : undefined
            }
            onClick={() =>
              void config.save(
                versioningXml(status === "Enabled" ? "Suspended" : "Enabled"),
                status === "Enabled" ? "Versionierung pausiert" : "Versionierung aktiviert",
              )
            }
          >
            {status === "Enabled" ? "Pausieren" : "Aktivieren"}
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
