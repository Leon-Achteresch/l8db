"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset}
      className={cn("px-2 py-1.5 text-sm font-medium data-inset:pl-8", className)}
      {...props}
    />
  );
}
