"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import * as React from "react";
import { usePortalContainer } from "@/lib/portal-container";
import { cn } from "@/lib/utils";
import { DropdownMenuArrow } from "./dropdown-menu-arrow";
import { useMenuArrowContainer } from "./use-menu-arrow-container";

export function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  arrowPadding = 12,
  ref,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const portalContainer = usePortalContainer();
  const [arrowContainer, attach] = useMenuArrowContainer(ref);
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        ref={attach}
        data-slot="dropdown-menu-content"
        arrowPadding={arrowPadding}
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[9px] bg-(--menu) p-1.25 text-popover-foreground shadow-(--shadow-menu) ease-smooth-out data-open:duration-250 data-closed:duration-150 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-97 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-99",
          className,
        )}
        {...props}
      >
        {children}
        <DropdownMenuArrow container={arrowContainer} />
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}
