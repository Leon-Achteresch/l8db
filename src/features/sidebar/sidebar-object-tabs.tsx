import type { LucideIcon } from "lucide-react";
import { startTransition, useOptimistic } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

export type SidebarObjectTab = {
  value: string;
  label: string;
  icon: LucideIcon;
  featureScope?: string;
  disabledReason?: string | null;
};

export function SidebarObjectTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => unknown;
}) {
  const [shown, setShown] = useOptimistic(value);
  const seen = useSeenNewFeatures();
  return (
    <Tabs
      value={shown}
      onValueChange={(next) =>
        startTransition(async () => {
          setShown(next);
          await onValueChange(next);
        })
      }
    >
      <TabsList className="@container w-full" data-icon-chrome>
        {tabs.map((tab) => (
          <Tooltip
            key={tab.value}
            content={tab.disabledReason ?? tab.label}
            side="bottom"
            wrapperClassName={cn(
              "h-full min-w-0",
              tab.value === shown ? "flex-1 @[17rem]:flex-none" : "flex-1",
            )}
          >
            <TabsTrigger
              value={tab.value}
              className={cn(
                "relative h-full w-full gap-1.5 px-0 transition-none after:bg-primary data-active:after:opacity-100",
                tab.value === shown && "@[17rem]:px-2.5",
              )}
              aria-label={tab.label}
              disabled={Boolean(tab.disabledReason)}
              title={tab.disabledReason ?? undefined}
            >
              <tab.icon className="size-4" />
              {tab.value === shown ? (
                <span className="hidden text-xs @[17rem]:inline">{tab.label}</span>
              ) : null}
              {hasNewFeatures(tab.featureScope, seen) ? (
                <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />
              ) : null}
            </TabsTrigger>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}
