import { TrashIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LifecycleRule } from "@/lib/storage/s3";

function DaysField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={1}
        className="h-7 text-xs"
        placeholder="–"
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        }}
      />
    </div>
  );
}

export function LifecycleRuleEditor({
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  rule: LifecycleRule;
  disabled: boolean;
  onChange: (rule: LifecycleRule) => void;
  onRemove: () => void;
}) {
  const patch = (next: Partial<LifecycleRule>) => onChange({ ...rule, ...next });
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Regel-ID"
          className="h-7 flex-1 text-xs"
          value={rule.id}
          disabled={disabled}
          onChange={(event) => patch({ id: event.target.value })}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <Switch
            checked={rule.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
          Aktiv
        </label>
        {!disabled && (
          <IconButton
            size="icon-xs"
            variant="ghost"
            aria-label="Regel entfernen"
            onClick={onRemove}
          >
            <TrashIcon />
          </IconButton>
        )}
      </div>
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Präfix (leer = ganzer Bucket)</Label>
        <Input
          className="h-7 font-mono text-xs"
          value={rule.prefix}
          disabled={disabled}
          placeholder="logs/"
          onChange={(event) => patch({ prefix: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <DaysField
          label="Löschen nach Tagen"
          value={rule.expirationDays}
          disabled={disabled}
          onChange={(v) => patch({ expirationDays: v })}
        />
        <DaysField
          label="Alte Versionen löschen nach"
          value={rule.noncurrentDays}
          disabled={disabled}
          onChange={(v) => patch({ noncurrentDays: v })}
        />
        <DaysField
          label="Uploads abbrechen nach"
          value={rule.abortMultipartDays}
          disabled={disabled}
          onChange={(v) => patch({ abortMultipartDays: v })}
        />
        <DaysField
          label="Übergang nach Tagen"
          value={rule.transitionDays}
          disabled={disabled}
          onChange={(v) => patch({ transitionDays: v })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {rule.transitionDays ? (
          <Input
            aria-label="Ziel-Speicherklasse"
            className="h-7 w-48 text-xs"
            placeholder="GLACIER / Tier-Name"
            value={rule.transitionClass}
            disabled={disabled}
            onChange={(event) => patch({ transitionClass: event.target.value })}
          />
        ) : null}
        {!rule.expirationDays && (
          <label className="flex items-center gap-1.5 text-xs">
            <Switch
              checked={rule.expiredDeleteMarker}
              disabled={disabled}
              onCheckedChange={(expiredDeleteMarker) => patch({ expiredDeleteMarker })}
            />
            Verwaiste Delete-Marker entfernen
          </label>
        )}
        {rule.extra && (
          <span className="text-[11px] text-muted-foreground">
            + weitere Bedingungen bleiben erhalten
          </span>
        )}
      </div>
    </div>
  );
}
