import { ArrowRightIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { VersioningIconButton } from "./versioning-icon-button";

export function VersioningOverviewCard({
  icon: Icon,
  title,
  action,
  onOpen,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border/60 bg-background p-3.5"
    >
      <header className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.7} />
        <h3 className="flex-1 text-xs font-semibold">{title}</h3>
        <VersioningIconButton
          icon={ArrowRightIcon}
          label={action}
          className="size-7"
          onClick={onOpen}
        />
      </header>
      {children}
    </section>
  );
}
