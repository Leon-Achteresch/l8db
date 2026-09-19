import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";

export function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}
