import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, KeyboardEvent } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ICON_MENU_SURFACE, moveIconMenuFocus } from "./shared";

export function IconMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  onKeyDown,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-icon-menu=""
        align={align}
        sideOffset={sideOffset}
        loop
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          moveIconMenuFocus(event);
        }}
        className={cn(ICON_MENU_SURFACE, className)}
        {...props}
      >
        <TooltipProvider delayDuration={250} skipDelayDuration={500}>
          {children}
        </TooltipProvider>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}
