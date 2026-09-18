"use client";

import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";

export function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}
