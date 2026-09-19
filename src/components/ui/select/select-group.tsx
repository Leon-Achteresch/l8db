"use client";

import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn(
        "scroll-my-1 p-1 [&:not(:has([data-slot=select-item]:not([data-filtered])))]:hidden",
        className,
      )}
      {...props}
    />
  );
}
