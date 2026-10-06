import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ContextMenuLazyContext } from "./context-menu-lazy";

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  const lazy = React.useContext(ContextMenuLazyContext);
  if (lazy && !lazy.live) return null;
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-150 ease-smooth-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}
