import { useId } from "react";
import { Input } from "@/components/ui/input";
import { useAiStore } from "@/lib/ai/store";
import type { AiPricing, AiProfile } from "@/lib/db/ai";

export function AiUsageSettings({ profile }: { profile: AiProfile }) {
  const id = useId();
  const save = useAiStore((state) => state.saveProfile);
  const pricing = profile.pricing?.model === profile.model ? profile.pricing : undefined;
  const fields: { key: Exclude<keyof AiPricing, "model">; label: string; step: string }[] = [
    { key: "inputUsd", label: "Eingabe · USD / 1 Mio. Tokens", step: "0.01" },
    { key: "outputUsd", label: "Ausgabe · USD / 1 Mio. Tokens", step: "0.01" },
    { key: "cachedInputUsd", label: "Cache lesen · USD / 1 Mio. Tokens", step: "0.01" },
    { key: "cacheWriteUsd", label: "Cache schreiben · USD / 1 Mio. Tokens", step: "0.01" },
    { key: "contextWindow", label: "Kontextlimit · Tokens", step: "1" },
  ];
  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="font-medium">Tokens &amp; Kostenschätzung</h3>
      <p className="text-muted-foreground">
        Eigene Tarife für {profile.model || "das Standardmodell"}: Eingabe und Ausgabe müssen beide
        angegeben sein. Sonst gelten bekannte Standardtarife. Native Kostenmeldungen haben Vorrang.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <label key={field.key} htmlFor={`${id}-${field.key}`} className="block space-y-1">
            <span>{field.label}</span>
            <Input
              id={`${id}-${field.key}`}
              type="number"
              min="0"
              step={field.step}
              placeholder="Automatisch"
              value={pricing?.[field.key] ?? ""}
              onChange={(event) => {
                const raw = event.target.value;
                const value = raw === "" ? undefined : Number(raw);
                if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
                save({
                  ...profile,
                  pricing: { ...pricing, model: profile.model, [field.key]: value },
                });
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-muted-foreground">
        Bei eigenen Tarifen verwenden leere Cachefelder deinen Eingabepreis. Der Tarif bleibt an die
        ausgewählte Modell-ID gebunden.
      </p>
    </div>
  );
}
