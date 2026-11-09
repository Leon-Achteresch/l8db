"use client";

import { type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { TabsListMotionContext, tabsListVariants } from "./shared";

export function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const id = React.useId();
  const state = React.useMemo(() => ({ id, variant: variant ?? "default" }), [id, variant]);
  return (
    <TabsListMotionContext.Provider value={state}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsListMotionContext.Provider>
  );
}
