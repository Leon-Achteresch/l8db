import { PlusIcon, TrashIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface KeyValue {
  key: string;
  value: string;
}

export function KeyValueEditor({
  items,
  onChange,
  keyLabel = "Schlüssel",
  valueLabel = "Wert",
  addLabel = "Eintrag hinzufügen",
  disabled = false,
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<KeyValue>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <div className="grid gap-1.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            aria-label={keyLabel}
            placeholder={keyLabel}
            className="h-8 text-xs"
            value={item.key}
            disabled={disabled}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            aria-label={valueLabel}
            placeholder={valueLabel}
            className="h-8 text-xs"
            value={item.value}
            disabled={disabled}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <IconButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Eintrag entfernen"
            disabled={disabled}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <TrashIcon className="size-3.5" />
          </IconButton>
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="justify-self-start"
          onClick={() => onChange([...items, { key: "", value: "" }])}
        >
          <PlusIcon /> {addLabel}
        </Button>
      )}
    </div>
  );
}
