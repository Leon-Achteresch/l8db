import { useState } from "react";
import { Input } from "@/components/ui/input";

export function UiPluginNumberInput({
  id,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  value: number;
  min: number | undefined;
  max: number | undefined;
  step: number | undefined;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      id={id}
      type="number"
      className="h-8 text-xs"
      value={draft ?? String(value)}
      min={min}
      max={max}
      step={step}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        const next = event.currentTarget.valueAsNumber;
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}
