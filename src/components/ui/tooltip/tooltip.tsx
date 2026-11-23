"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";
import { TooltipScope } from "./tooltip-scope";

export function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  if (React.useContext(TooltipScope)) return root;
  return <TooltipPrimitive.Provider delayDuration={0}>{root}</TooltipPrimitive.Provider>;
}
