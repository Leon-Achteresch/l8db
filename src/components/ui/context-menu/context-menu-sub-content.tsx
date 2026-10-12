import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextMenuSubContent({
  className,
  sideOffset = -5,
  alignOffset = -5,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        data-slot="context-menu-sub-content"
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-48 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[9px] bg-(--menu) p-1.25 text-popover-foreground shadow-(--shadow-menu) duration-150 ease-smooth-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}
