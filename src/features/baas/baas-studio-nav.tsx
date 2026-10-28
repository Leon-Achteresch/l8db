import { startTransition, useOptimistic } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SidebarObjectTab } from "@/features/sidebar/sidebar-object-tabs";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";

export type BaasStudioTab = SidebarObjectTab & { group?: string };

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
  const groups: { name?: string; tabs: BaasStudioTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups.at(-1);
    if (last && last.name === tab.group) last.tabs.push(tab);
    else groups.push({ name: tab.group, tabs: [tab] });
  }

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
      <TabsList
        variant="line"
        className="h-auto! w-full items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden p-0 [scrollbar-width:none]"
      >
        {groups.map((group, index) => (
          <div
            key={group.name ?? index}
            role="presentation"
            className="flex shrink-0 flex-col justify-end border-l border-border/60 px-1 pt-2 first:border-l-0 [&:not(:has(>span))]:pt-0 first:pl-0"
          >
            {group.name && (
              <span
                aria-hidden="true"
                className="mb-0.5 h-3 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
              >
                {group.name}
              </span>
            )}
            <div role="presentation" className="flex">
              {group.tabs.map((tab) => (
                <span
                  key={tab.value}
                  role="presentation"
                  title={tab.disabledReason ?? undefined}
                  className="flex"
                >
                  <TabsTrigger
                    value={tab.value}
                    disabled={Boolean(tab.disabledReason)}
                    title={tab.disabledReason ?? undefined}
                    className="h-9 flex-none gap-1.5 rounded-none px-2 text-xs font-medium after:inset-x-2! [&_svg]:size-3.5!"
                  >
                    <tab.icon />
                    {tab.label}
                    {hasNewFeatures(tab.featureScope, seen) && (
                      <NewBadge className="-mr-1 px-1 text-[8px]" />
                    )}
                  </TabsTrigger>
                </span>
              ))}
            </div>
          </div>
        ))}
      </TabsList>
    </Tabs>
  );
}
