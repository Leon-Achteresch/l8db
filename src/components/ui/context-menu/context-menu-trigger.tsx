import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextMenuTrigger({
  className,
  highlight = true,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger> & {
  highlight?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", highlight && "context-menu-target", className)}
      {...props}
    />
  );
}
