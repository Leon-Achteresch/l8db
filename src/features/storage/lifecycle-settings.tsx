import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  emptyLifecycleRule,
  type LifecycleRule,
  lifecycleXml,
  parseLifecycle,
} from "@/lib/storage/s3";
import { LifecycleRuleEditor } from "./lifecycle-rule-editor";
import { SettingsCard } from "./settings-card";
import { useBucketConfig } from "./use-bucket-config";

export function LifecycleSettings({ bucket }: { bucket: string }) {
  const config = useBucketConfig(bucket, "lifecycle");
  const [rules, setRules] = useState<LifecycleRule[]>([]);

  useEffect(() => {
    setRules(parseLifecycle(config.data));
  }, [config.data]);

  return (
    <SettingsCard
      title="Lifecycle-Regeln"
      description="Automatisches Löschen, Aufräumen alter Versionen und Speicherklassen-Übergänge."
      loading={config.loading}
      error={config.error}
      unsupported={config.unsupported}
    >
      {rules.length === 0 && <p className="text-xs text-muted-foreground">Keine Regeln.</p>}
      {rules.map((rule, index) => (
        <LifecycleRuleEditor
          key={index}
          rule={rule}
          disabled={config.readOnly}
          onChange={(next) => setRules(rules.map((r, i) => (i === index ? next : r)))}
          onRemove={() => setRules(rules.filter((_, i) => i !== index))}
        />
      ))}
      {!config.readOnly && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRules([...rules, emptyLifecycleRule(rules.length)])}
          >
            <PlusIcon /> Regel
          </Button>
          <Button
            size="sm"
            disabled={config.busy}
            onClick={() =>
              void (rules.length
                ? config.save(lifecycleXml(rules), "Lifecycle gespeichert")
                : config.remove("Lifecycle entfernt"))
            }
          >
            Speichern
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
