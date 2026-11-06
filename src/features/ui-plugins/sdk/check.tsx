import { CheckIcon, MinusIcon } from "lucide-react";
import { TONE_COLORS } from "@/lib/ui-plugins/tones";

export function Check({ checked, label }: { checked: boolean; label?: string }) {
  const Icon = checked ? CheckIcon : MinusIcon;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-sans text-xs">
      <Icon
        aria-label={checked ? "ja" : "nein"}
        className="size-3.5 shrink-0"
        style={{ color: checked ? TONE_COLORS.success : TONE_COLORS.neutral }}
      />
      {label !== undefined && <span className="truncate">{label}</span>}
    </span>
  );
}
