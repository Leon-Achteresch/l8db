import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface McpEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function McpEmptyState({ icon: Icon, title, description, action }: McpEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-3 text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
