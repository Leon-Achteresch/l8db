import type { ReactNode } from "react";
import { SettingsRow } from "@/features/settings/settings-row";

export function Row({
  title,
  description,
  compact,
  children,
}: {
  title: string;
  description: string;
  compact: boolean;
  children: ReactNode;
}) {
  if (!compact) {
    return (
      <SettingsRow title={title} description={description}>
        {children}
      </SettingsRow>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}
