import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";

interface QueryBuilderSectionProps {
  title: string;
  count?: number;
  addLabel?: string;
  addDisabled?: boolean;
  onAdd?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function QueryBuilderSection({
  title,
  count,
  addLabel,
  addDisabled,
  onAdd,
  actions,
  children,
}: QueryBuilderSectionProps) {
  return (
    <section className="space-y-2 border-b px-3 py-3 last:border-b-0">
      <div className="flex h-6 items-center gap-1.5">
        <h3 className="text-xs font-medium">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {onAdd && addLabel && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={addLabel}
              disabled={addDisabled}
              onClick={onAdd}
            >
              <PlusIcon />
            </IconButton>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
