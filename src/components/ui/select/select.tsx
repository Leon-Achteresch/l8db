"use client";

import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";

export function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}
