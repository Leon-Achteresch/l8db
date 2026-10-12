import type { LucideIcon } from "lucide-react";
import { startTransition, useOptimistic } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";

export type SidebarObjectTab = {
  value: string;
  label: string;
  icon: LucideIcon;
  featureScope?: string;
};

export function SidebarObjectTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [shown, setShown] = useOptimistic(value);
  const seen = useSeenNewFeatures();
  return (
    <Tabs
      value={shown}
      onValueChange={(next) =>
        startTransition(() => {
          setShown(next);
          onValueChange(next);
        })
      }
    >
      <TabsList className="w-full">
        {tabs.map((tab) => (
          <Tooltip
            key={tab.value}
            content={tab.label}
            side="bottom"
            wrapperClassName="h-full flex-1"
          >
            <TabsTrigger
              value={tab.value}
              className="relative h-full w-full px-0 transition-none"
              aria-label={tab.label}
            >
              <tab.icon className="size-4" />
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
