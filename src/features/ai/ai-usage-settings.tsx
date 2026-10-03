import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAiStore } from "@/lib/ai/store";
import type { AiPricing, AiProfile } from "@/lib/db/ai";

type PricingKey = Exclude<keyof AiPricing, "model">;

export function AiUsageSettings({ profile }: { profile: AiProfile }) {
  const id = useId();
  const save = useAiStore((state) => state.saveProfile);
  const pricing = profile.pricing?.model === profile.model ? profile.pricing : undefined;
  const fields: { key: PricingKey; label: string }[] = [
    { key: "inputUsd", label: "Eingabe" },
    { key: "outputUsd", label: "Ausgabe" },
    { key: "cachedInputUsd", label: "Cache lesen" },
    { key: "cacheWriteUsd", label: "Cache schreiben" },
  ];
  const custom = fields.some((field) => pricing?.[field.key] !== undefined);
  const input = (key: PricingKey, step: string) => (
    <Input
      id={`${id}-${key}`}
      type="number"
      min="0"
      step={step}
      placeholder="Automatisch"
      value={pricing?.[key] ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        const value = raw === "" ? undefined : Number(raw);
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
        save({ ...profile, pricing: { ...pricing, model: profile.model, [key]: value } });
      }}
    />
  );
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div>Tarif &amp; Kontextlimit</div>
        <div className="truncate text-muted-foreground">
          {custom ? "Eigener Tarif" : "Automatisch"}
          {pricing?.contextWindow ? ` · ${pricing.contextWindow.toLocaleString()} Tokens` : ""}
        </div>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            Anpassen
          </Button>
        </DialogTrigger>
        <DialogContent className="text-xs">
          <DialogHeader>
            <DialogTitle>Tokens &amp; Kostenschätzung</DialogTitle>
            <DialogDescription>
              Eigene Tarife für {profile.model || "das Standardmodell"} in USD pro 1 Mio. Tokens.
              Leer lassen für bekannte Standardtarife; native Kostenmeldungen haben Vorrang.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((field) => (
              <label key={field.key} htmlFor={`${id}-${field.key}`} className="block space-y-1">
                <span>{field.label}</span>
                {input(field.key, "0.01")}
              </label>
            ))}
            <label htmlFor={`${id}-contextWindow`} className="col-span-2 block space-y-1">
              <span>Kontextlimit · Tokens</span>
              {input("contextWindow", "1")}
            </label>
          </div>
          <p className="text-muted-foreground">
            Eingabe und Ausgabe müssen beide angegeben sein. Leere Cachefelder verwenden den
            Eingabepreis. Der Tarif bleibt an die ausgewählte Modell-ID gebunden.
          </p>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              disabled={!pricing}
              onClick={() => save({ ...profile, pricing: undefined })}
            >
              Zurücksetzen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
