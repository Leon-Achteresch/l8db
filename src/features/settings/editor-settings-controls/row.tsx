import type { ReactNode } from "react";
import { SettingsRow } from "@/features/settings/settings-row";
import { SETTINGS_BY_ID } from "@/lib/settings-catalog";

export function Row({
  settingId,
  title: fallbackTitle,
  description: fallbackDescription,
  compact,
  children,
}: {
  settingId?: string;
  title?: string;
  description?: string;
  compact: boolean;
  children: ReactNode;
}) {
  const setting = settingId ? SETTINGS_BY_ID.get(settingId) : undefined;
  const title = setting?.title ?? fallbackTitle ?? "";
  const description = setting?.description ?? fallbackDescription ?? "";
  if (!compact) {
    return (
      <SettingsRow settingId={settingId} title={title} description={description}>
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
