import { ArrowUpRight, type LucideIcon } from "lucide-react";
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
        "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-muted/70 disabled:cursor-wait disabled:opacity-60",
        primary && "bg-primary/7 hover:bg-primary/12",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0 text-muted-foreground", primary && "text-primary")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", primary && "text-primary")}>{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
      />
    </button>
  );
}
