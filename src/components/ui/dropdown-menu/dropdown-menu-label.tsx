"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 pt-1.5 pb-1 text-[11px] leading-4 font-medium text-muted-foreground data-inset:pl-8",
        className,
      )}
      {...props}
    />
  );
}
