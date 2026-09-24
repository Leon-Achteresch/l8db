"use client";

import type { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { TabsStateContext, tabsContentId, tabsTriggerId } from "./shared";

export function TabsContent({
  className,
  value,
  forceMount,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const state = React.useContext(TabsStateContext);
  const selected = state?.value === value;
  const present = Boolean(forceMount) || selected;
  return (
    <div
      data-slot="tabs-content"
      data-state={selected ? "active" : "inactive"}
      data-orientation={state?.orientation}
      role="tabpanel"
      aria-labelledby={state ? tabsTriggerId(state.baseId, value) : undefined}
      id={state ? tabsContentId(state.baseId, value) : undefined}
      hidden={!present}
      tabIndex={0}
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    >
      {present && children}
    </div>
  );
}
