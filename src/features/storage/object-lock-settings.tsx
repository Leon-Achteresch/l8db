import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ObjectLockConfig, objectLockXml, parseObjectLock } from "@/lib/storage/s3";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

export function ObjectLockSettings({ bucket }: { bucket: string }) {
  const config = useBucketConfig(bucket, "object-lock");
  const [draft, setDraft] = useState<ObjectLockConfig>({
    enabled: false,
    mode: "",
    days: null,
    years: null,
  });

  const [confirming, setConfirming] = useState(false);
  const save = () => config.save(objectLockXml(draft), "Objektsperre gespeichert");

  useEffect(() => {
    setDraft(parseObjectLock(config.data));
  }, [config.data]);

  return (
    <SettingsCard
      title="Objektsperre (Object Lock)"
      description={
        draft.enabled
          ? "Aktiv. Standard-Aufbewahrung gilt für neue Objekte."
          : "Nicht aktiviert – nur beim Anlegen eines Buckets einschaltbar."
      }
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
    >
      {draft.enabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={draft.mode || "none"}
            disabled={config.readOnly}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                mode: value === "none" ? "" : (value as ObjectLockConfig["mode"]),
              })
            }
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Standard-Modus">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Keine Standard-Aufbewahrung</SelectItem>
              <SelectItem value="GOVERNANCE">Governance</SelectItem>
              <SelectItem value="COMPLIANCE">Compliance</SelectItem>
            </SelectContent>
          </Select>
          {draft.mode && (
            <Input
              type="number"
              min={1}
              aria-label="Tage"
              className="h-8 w-28 text-xs"
              placeholder="Tage"
              disabled={config.readOnly}
              value={draft.days ?? ""}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setDraft({ ...draft, days: parsed > 0 ? parsed : null, years: null });
              }}
            />
          )}
          {!config.readOnly && (
            <Button
              size="sm"
              disabled={config.busy}
              onClick={() => (draft.mode === "COMPLIANCE" ? setConfirming(true) : void save())}
            >
              Speichern
            </Button>
          )}
        </div>
      )}
      <ConfirmActionDialog
        open={confirming}
        title="Compliance als Standard?"
        description={`Neue Objekte in „${bucket}“ sind ${draft.days ?? draft.years ?? "–"} ${draft.days ? "Tage" : "Jahre"} lang nicht löschbar, auch nicht für Admins.`}
        confirmLabel="Speichern"
        onOpenChange={setConfirming}
        onConfirm={async () => {
          await save();
        }}
      />
    </SettingsCard>
  );
}
