import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";

export function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />;
}
