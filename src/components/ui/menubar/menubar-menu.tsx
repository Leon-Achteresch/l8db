"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

export function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}
