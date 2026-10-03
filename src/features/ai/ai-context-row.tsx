import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AiContextRow({
  icon,
  label,
  hint,
  checked,
  disabled,
  title,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onToggle}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/50">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        {hint && <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked && <Check className="size-2.5" strokeWidth={3} />}
      </span>
    </button>
  );
}
