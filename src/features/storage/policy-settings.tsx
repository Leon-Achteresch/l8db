import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type PolicyPreset, policyPreset } from "@/lib/storage/s3";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

const PRESETS: [PolicyPreset, string][] = [
  ["private", "Privat (Policy entfernen)"],
  ["public-read", "Öffentlich lesbar"],
  ["public-list", "Öffentlich lesbar + auflistbar"],
  ["public-read-write", "Öffentlich lesen und schreiben"],
];

function pretty(text: string | null): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function PolicySettings({ bucket }: { bucket: string }) {
  const config = useBucketConfig(bucket, "policy");
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  useEffect(() => {
    setDraft(pretty(config.data));
  }, [config.data]);

  function save() {
    if (!draft.trim()) {
      void config.remove("Policy entfernt");
      return;
    }
    try {
      JSON.parse(draft);
      setInvalid(null);
      void config.save(draft, "Policy gespeichert");
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <SettingsCard
      title="Bucket-Policy"
      description={
        config.data ? "Eine Policy ist gesetzt." : "Keine Policy – nur authentifizierter Zugriff."
      }
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
      actions={
        !config.readOnly && (
          <Select
            value=""
            onValueChange={(value) => {
              const preset = policyPreset(bucket, value as PolicyPreset);
              if (preset === null) void config.remove("Policy entfernt");
              else setDraft(preset);
            }}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Vorlage">
              <SelectValue placeholder="Vorlage…" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      <Textarea
        aria-label="Policy JSON"
        className="min-h-40 font-mono text-xs"
        value={draft}
        readOnly={config.readOnly}
        placeholder='{ "Version": "2012-10-17", "Statement": [] }'
        onChange={(event) => setDraft(event.target.value)}
      />
      {invalid && <p className="text-xs text-destructive">Ungültiges JSON: {invalid}</p>}
      {!config.readOnly && (
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={config.busy}>
            Policy speichern
          </Button>
          {config.data && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void config.remove("Policy entfernt")}
              disabled={config.busy}
            >
              Entfernen
            </Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
