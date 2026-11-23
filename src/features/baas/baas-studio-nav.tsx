import { startTransition, useOptimistic } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SidebarObjectTab } from "@/features/sidebar/sidebar-object-tabs";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

export type BaasStudioTab = SidebarObjectTab & { status?: { healthy: boolean; label: string } };

export function BaasStudioNav({
  tabs,
  value,
  onValueChange,
}: {
  tabs: BaasStudioTab[];
  value: string;
  onValueChange: (value: string) => unknown;
}) {
  const [shown, setShown] = useOptimistic(value);
  const seen = useSeenNewFeatures();

  return (
    <Tabs
      orientation="vertical"
      value={shown}
      onValueChange={(next) =>
        startTransition(async () => {
          setShown(next);
          await onValueChange(next);
        })
      }
      className="@container"
    >
      <TabsList className="block h-auto w-full columns-1 gap-1 bg-transparent p-0 @[15rem]:columns-2">
        {tabs.map((tab) => (
          <span
            key={tab.value}
            role="presentation"
            title={tab.disabledReason ?? tab.status?.label}
            className="block break-inside-avoid"
          >
            <TabsTrigger
              value={tab.value}
              disabled={Boolean(tab.disabledReason)}
              className="flex h-7 w-full flex-none justify-start gap-2 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-foreground/5 [&_svg]:size-3.5! data-active:[&_svg]:text-primary"
            >
              <tab.icon />
              <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
              {hasNewFeatures(tab.featureScope, seen) && (
                <NewBadge className="-mr-1 px-1 text-[8px]" />
              )}
              {tab.status && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tab.status.healthy ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
              )}
            </TabsTrigger>
          </span>
        ))}
      </TabsList>
    </Tabs>
  );
}
