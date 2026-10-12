"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import * as React from "react";
import { usePortalContainer } from "@/lib/portal-container";

export function DropdownMenuPortal({
  container,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  const scopedContainer = usePortalContainer();
  return (
    <DropdownMenuPrimitive.Portal
      data-slot="dropdown-menu-portal"
      container={container === undefined ? scopedContainer : container}
      {...props}
    />
  );
}
