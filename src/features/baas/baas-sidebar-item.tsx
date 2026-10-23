import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar/shared";
import { cn } from "@/lib/utils";

export function BaasSidebarItem({
  icon: Icon,
  active,
  onClick,
  title,
  children,
  hint,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-active={active || undefined}
      title={title}
      onClick={onClick}
      className={cn(sidebarMenuButtonVariants(), "text-xs")}
    >
      <Icon className="text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {hint !== undefined && hint !== null && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}
