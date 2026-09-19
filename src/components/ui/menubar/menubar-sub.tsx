"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

export function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}
