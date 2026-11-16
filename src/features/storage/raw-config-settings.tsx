import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BucketResource } from "@/lib/db";
import { ConfirmActionDialog } from "./confirm-action-dialog";
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
  const [invalid, setInvalid] = useState(false);
  const [removing, setRemoving] = useState(false);

  function save() {
    const parsed = new DOMParser().parseFromString(draft, "application/xml");
    const broken = parsed.getElementsByTagName("parsererror").length > 0;
    setInvalid(broken);
    if (!broken) void config.save(draft, `${title} gespeichert`);
  }

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
      {invalid && <p className="text-xs text-destructive">Kein gültiges XML.</p>}
      {!locked && (
        <div className="flex gap-2">
          <Button size="sm" disabled={config.busy || !draft.trim()} onClick={save}>
            Speichern
          </Button>
          {deletable && config.data && (
            <Button
              size="sm"
              variant="outline"
              disabled={config.busy}
              onClick={() => setRemoving(true)}
            >
              Entfernen
            </Button>
          )}
        </div>
      )}
      <ConfirmActionDialog
        open={removing}
        title={`${title} entfernen?`}
        description={`Die Konfiguration von „${bucket}“ wird gelöscht.`}
        confirmLabel="Entfernen"
        onOpenChange={setRemoving}
        onConfirm={async () => {
          await config.remove(`${title} entfernt`);
        }}
      />
    </SettingsCard>
  );
}
