import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        "z-50 max-h-(--radix-context-menu-content-available-height) min-w-32 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg duration-150 ease-smooth-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}
