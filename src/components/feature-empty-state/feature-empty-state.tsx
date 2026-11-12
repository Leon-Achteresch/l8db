import type { LucideIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FeatureEmptyStateClip = lazy(() =>
  import("@/components/feature-empty-state/feature-empty-state-clip").then(
    ({ FeatureEmptyStateClip }) => ({ default: FeatureEmptyStateClip }),
  ),
);

export interface FeatureEmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export function FeatureEmptyState({
  icon: Icon,
  title,
  action,
  featureId,
  className,
}: {
  icon: LucideIcon;
  title: string;
  action?: FeatureEmptyStateAction;
  featureId?: string;
  className?: string;
}) {
  const ActionIcon = action?.icon;
  return (
    <div
      data-empty-state
      className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}
    >
      {featureId && (
        <Suspense fallback={null}>
          <FeatureEmptyStateClip featureId={featureId} />
        </Suspense>
      )}
      <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {(action || featureId) && (
        <div className="flex flex-wrap justify-center gap-2">
          {action && (
            <Button type="button" size="sm" onClick={action.onClick}>
              {ActionIcon && <ActionIcon />}
              {action.label}
            </Button>
          )}
          {featureId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void import("@/lib/discovery/highlight").then(({ highlightFeature }) =>
                  highlightFeature(featureId),
                )
              }
            >
              Wo finde ich das?
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
