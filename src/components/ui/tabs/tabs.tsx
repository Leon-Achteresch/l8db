"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { TabsStateContext } from "./shared";

export function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const baseId = React.useId();
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const current = value ?? uncontrolled;
  const state = React.useMemo(
    () => ({ baseId, value: current, orientation }),
    [baseId, current, orientation],
  );
  return (
    <TabsStateContext.Provider value={state}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        value={current}
        onValueChange={(next) => {
          setUncontrolled(next);
          onValueChange?.(next);
        }}
        className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
        {...props}
      />
    </TabsStateContext.Provider>
  );
}
