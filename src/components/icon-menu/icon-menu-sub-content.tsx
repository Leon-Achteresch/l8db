import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, KeyboardEvent } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ICON_MENU_SURFACE, moveIconMenuFocus } from "./shared";

export function IconMenuSubContent({
  className,
  onKeyDown,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-icon-menu=""
        sideOffset={-32}
        alignOffset={42}
        loop
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          moveIconMenuFocus(event);
        }}
        className={cn(ICON_MENU_SURFACE, "max-w-none flex-nowrap", className)}
        {...props}
      >
        <TooltipProvider delayDuration={250} skipDelayDuration={500}>
          {children}
        </TooltipProvider>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  );
}
