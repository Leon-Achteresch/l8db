"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

export function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}
