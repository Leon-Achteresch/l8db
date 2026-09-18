import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";

export function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}
