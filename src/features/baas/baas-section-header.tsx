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
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1">
      <div className="min-w-0 max-w-2xl">
        <h2
          ref={titleRef}
          title={typeof description === "string" ? description : undefined}
          className="flex items-center gap-2 text-xl font-semibold tracking-[-0.025em] text-balance"
        >
          {title}
          {isNew && <NewBadge />}
        </h2>
        {description && typeof description !== "string" && (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
