"use client";

import { Menubar as MenubarPrimitive } from "radix-ui";
import * as React from "react";

export function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}
