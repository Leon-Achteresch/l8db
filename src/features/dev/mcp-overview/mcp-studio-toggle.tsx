import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface McpStudioToggleProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  tone?: "warn";
  onChange: (value: boolean) => void;
}

export function McpStudioToggle({
  label,
  checked,
  disabled,
  tone,
  onChange,
}: McpStudioToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg px-1 py-1.5 text-sm",
        disabled && "opacity-40",
      )}
    >
      <span className={cn(tone === "warn" && checked && "text-amber-600 dark:text-amber-400")}>
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
