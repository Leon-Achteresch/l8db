"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

export function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}
