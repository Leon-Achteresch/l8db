import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BucketResource } from "@/lib/db";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

export function RawConfigSettings({
  bucket,
  resource,
  title,
  description,
  template,
  readOnly = false,
  deletable = true,
}: {
  bucket: string;
  resource: BucketResource;
  title: string;
  description: string;
  template?: string;
  readOnly?: boolean;
  deletable?: boolean;
}) {
  const config = useBucketConfig(bucket, resource);
  const [draft, setDraft] = useState("");
  const locked = readOnly || config.readOnly;

  useEffect(() => {
    setDraft(config.data ?? "");
  }, [config.data]);

  return (
    <SettingsCard
      title={title}
      description={description}
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
      actions={
        !locked && template && !draft.trim() ? (
          <Button size="sm" variant="outline" onClick={() => setDraft(template)}>
            Vorlage einfügen
          </Button>
        ) : null
      }
    >
      {locked && !draft ? (
        <p className="text-xs text-muted-foreground">Nicht konfiguriert.</p>
      ) : (
        <Textarea
          aria-label={`${title} XML`}
          className="min-h-28 font-mono text-xs"
          value={draft}
          readOnly={locked}
          placeholder="Nicht konfiguriert."
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {!locked && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={config.busy || !draft.trim()}
            onClick={() => void config.save(draft, `${title} gespeichert`)}
          >
            Speichern
          </Button>
          {deletable && config.data && (
            <Button
              size="sm"
              variant="outline"
              disabled={config.busy}
              onClick={() => void config.remove(`${title} entfernt`)}
            >
              Entfernen
            </Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
