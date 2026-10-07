import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useModifiedSettings } from "@/lib/hooks/use-modified-settings";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NewFeatureId } from "@/lib/new-features";
import { SETTINGS_BY_ID } from "@/lib/settings-catalog";
import { cn } from "@/lib/utils";

interface Props {
  settingId?: string;
  title?: string;
  description?: string;
  children?: ReactNode;
  featureId?: NewFeatureId;
  resetDisabled?: boolean;
}

export function SettingsRow({
  settingId,
  title: fallbackTitle,
  description: fallbackDescription,
  children,
  featureId,
  resetDisabled,
}: Props) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>(featureId);
  const { modified, reset } = useModifiedSettings();
  const setting = settingId ? SETTINGS_BY_ID.get(settingId) : undefined;
  const title = setting?.title ?? fallbackTitle;
  const description = setting?.description ?? fallbackDescription;
  const changed = Boolean(settingId && modified.has(settingId));

  return (
    <motion.div
      ref={ref}
      data-setting-id={settingId}
      data-modified={changed || undefined}
      tabIndex={settingId ? -1 : undefined}
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className={cn(
        "group relative grid scroll-mt-4 items-center gap-x-8 gap-y-3 border-b border-border/60 pb-[calc(1rem+var(--ui-density-step))] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 @min-[38rem]:grid-cols-[minmax(0,1fr)_auto]",
        changed &&
          "pl-3 before:absolute before:left-0 before:top-0 before:bottom-4 before:w-0.5 before:rounded-full before:bg-primary",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span>{title}</span>
          {isNew ? <NewBadge /> : null}
          {changed ? (
            <>
              <Badge variant="secondary" className="text-[10px]">
                Geändert
              </Badge>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={resetDisabled}
                title={`${title} zurücksetzen`}
                aria-label={`${title} zurücksetzen`}
                onClick={() => settingId && reset(settingId)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        {settingId ? (
          <code className="pointer-events-none absolute bottom-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {setting?.key ? `settings.${setting.key}` : `settings.${settingId}`}
          </code>
        ) : null}
      </div>
      {children ? (
        <div className="flex min-w-0 shrink-0 flex-wrap justify-end">{children}</div>
      ) : null}
    </motion.div>
  );
}
