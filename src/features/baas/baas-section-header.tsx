import type { ReactNode, Ref } from "react";
import { NewBadge } from "@/components/new-badge";

export function BaasSectionHeader({
  title,
  description,
  actions,
  titleRef,
  isNew,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  isNew?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/60 pb-4">
      <div className="min-w-0 max-w-2xl">
        <h2
          ref={titleRef}
          className="flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-balance"
        >
          {title}
          {isNew && <NewBadge />}
        </h2>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
