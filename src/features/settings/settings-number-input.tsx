import { type ComponentProps, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SettingsNumberInput({
  value,
  min,
  max,
  onCommit,
  className,
  ...rest
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
} & Omit<ComponentProps<typeof Input>, "type" | "value" | "min" | "max" | "onChange">) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isNaN(parsed)) onCommit(Math.min(max, Math.max(min, parsed)));
    setDraft(null);
  }

  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
      className={cn(
        "h-8 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
      {...rest}
    />
  );
}
