import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function WelcomeAction({
  icon: Icon,
  label,
  description,
  primary,
  disabled,
  dataTour,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  primary?: boolean;
  disabled?: boolean;
  dataTour?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-tour={dataTour}
      onClick={onClick}
      className={cn(
        "welcome-action group flex w-full items-center gap-3 rounded-lg border border-transparent px-4 py-3 text-left transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "hover:border-border hover:bg-muted/60",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          primary ? "text-primary-foreground" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span
            className={cn(
              "mt-0.5 block text-xs leading-relaxed",
              primary ? "text-primary-foreground/85" : "text-muted-foreground",
            )}
          >
            {description}
          </span>
        )}
      </span>
      <ArrowRight
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          primary
            ? "text-primary-foreground"
            : "text-muted-foreground/60 group-hover:text-foreground",
        )}
      />
    </button>
  );
}
