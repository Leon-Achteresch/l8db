"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { SelectionHighlight } from "@/components/motion/selection-highlight";
import { cn } from "@/lib/utils";
import { TabsListMotionContext, TabsStateContext, tabsContentId, tabsTriggerId } from "./shared";

export function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const state = React.useContext(TabsStateContext);
  const list = React.useContext(TabsListMotionContext);
  const active = state?.value === props.value;
  return (
    <TabsPrimitive.Trigger
      id={state ? tabsTriggerId(state.baseId, props.value) : undefined}
      aria-controls={state ? tabsContentId(state.baseId, props.value) : undefined}
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "isolate data-active:text-foreground dark:data-active:text-foreground",
        className,
      )}
      {...props}
    >
      {active && list && (
        <SelectionHighlight
          id={`tabs-${list.id}`}
          className={
            list.variant === "line"
              ? "pointer-events-none absolute -bottom-px inset-x-1.5 -z-10 h-0.5 rounded-full bg-foreground group-data-vertical/tabs:inset-y-0 group-data-vertical/tabs:inset-x-auto group-data-vertical/tabs:-right-1 group-data-vertical/tabs:h-auto group-data-vertical/tabs:w-0.5"
              : "pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-background shadow-sm ring-1 ring-foreground/5 dark:bg-input/50"
          }
        />
      )}
      {children}
    </TabsPrimitive.Trigger>
  );
}
