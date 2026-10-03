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
        "z-50 min-w-32 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}
