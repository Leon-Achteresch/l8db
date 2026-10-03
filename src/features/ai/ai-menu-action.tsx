import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NewFeatureId } from "@/lib/new-features";

export function AiMenuAction({
  icon,
  label,
  hint,
  disabled,
  onClick,
  featureId,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  featureId?: NewFeatureId;
}) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>(featureId);
  return (
    <button
      ref={feature.ref}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/50">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-xs font-medium">
          {label}
          {feature.isNew && <NewBadge />}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
