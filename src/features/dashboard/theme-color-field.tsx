import { XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { isThemeColor } from "@/lib/dashboards";

function hexOf(value: string | undefined): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value;
  if (value && /^#[0-9a-f]{3}$/i.test(value))
    return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  return "#888888";
}

export function ThemeColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const invalid = Boolean(value) && !isThemeColor(value);
  return (
    <div className="flex items-center gap-2 text-xs">
      <input
        type="color"
        aria-label={`${label} wählen`}
        value={hexOf(value)}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
      />
      <span className="w-24 shrink-0">{label}</span>
      <Input
        aria-label={label}
        aria-invalid={invalid}
        value={value ?? ""}
        placeholder="Standard"
        onChange={(e) => onChange(e.target.value.trim() || undefined)}
        className="h-7 min-w-0 flex-1 font-mono text-xs"
      />
      {value && (
        <IconButton
          variant="ghost"
          size="icon-xs"
          aria-label={`${label} zurücksetzen`}
          onClick={() => onChange(undefined)}
        >
          <XIcon />
        </IconButton>
      )}
    </div>
  );
}
