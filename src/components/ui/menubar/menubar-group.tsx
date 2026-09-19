"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

export function MenubarGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}
