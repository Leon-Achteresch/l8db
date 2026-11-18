"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";
import { TooltipScope } from "./tooltip-scope";

export function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipScope.Provider value>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </TooltipScope.Provider>
  );
}
