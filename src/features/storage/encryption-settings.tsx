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
import { type EncryptionConfig, encryptionXml, parseEncryption } from "@/lib/storage/s3";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

export function EncryptionSettings({ bucket }: { bucket: string }) {
  const config = useBucketConfig(bucket, "encryption");
  const [draft, setDraft] = useState<EncryptionConfig>({ algorithm: "", kmsKeyId: "" });

  useEffect(() => {
    setDraft(parseEncryption(config.data));
  }, [config.data]);

  return (
    <SettingsCard
      title="Standard-Verschlüsselung"
      description="Serverseitige Verschlüsselung für neu hochgeladene Objekte."
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={draft.algorithm || "none"}
          disabled={config.readOnly}
          onValueChange={(value) =>
            setDraft({
              ...draft,
              algorithm: value === "none" ? "" : (value as EncryptionConfig["algorithm"]),
            })
          }
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Algorithmus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Keine</SelectItem>
            <SelectItem value="AES256">SSE-S3 (AES256)</SelectItem>
            <SelectItem value="aws:kms">SSE-KMS</SelectItem>
          </SelectContent>
        </Select>
        {draft.algorithm === "aws:kms" && (
          <Input
            aria-label="KMS-Schlüssel"
            className="h-8 w-64 text-xs"
            placeholder="KMS-Key-ID (leer = Standard)"
            value={draft.kmsKeyId}
            disabled={config.readOnly}
            onChange={(event) => setDraft({ ...draft, kmsKeyId: event.target.value })}
          />
        )}
        {!config.readOnly && (
          <Button
            size="sm"
            disabled={config.busy}
            onClick={() =>
              void (draft.algorithm
                ? config.save(encryptionXml(draft), "Verschlüsselung gespeichert")
                : config.remove("Verschlüsselung entfernt"))
            }
          >
            Speichern
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
