"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

export function MenubarPortal({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />;
}
