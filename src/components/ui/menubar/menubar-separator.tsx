"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
