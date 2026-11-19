import { useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { type SavedQueryOrigin, sanitizeSavedQueryOrigin } from "@/lib/saved-query-origin";

export function SavedQueryOriginChoice({
  origin: input,
  checked,
  onCheckedChange,
}: {
  origin?: SavedQueryOrigin;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const origin = sanitizeSavedQueryOrigin(input);
  const id = useId();
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.saved.origin");
  return (
    <div ref={feature.ref} className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={!origin}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <Label htmlFor={id} className="text-xs">
          Herkunft merken
        </Label>
        {feature.isNew && <NewBadge />}
      </div>
      <p
        className="truncate text-2xs text-muted-foreground"
        title={
          origin
            ? `${origin.connectionName ?? "Verbindung"} · ${origin.database ?? "Datenbank unbekannt"}`
            : undefined
        }
      >
        {checked && origin
          ? `${origin.connectionName ?? "Verbindung"} · ${origin.database ?? "Datenbank unbekannt"}`
          : "Allgemein · ohne Herkunft"}
      </p>
      <p className="text-2xs text-muted-foreground">Nur ein Hinweis, kein Ausführungsziel.</p>
    </div>
  );
}
