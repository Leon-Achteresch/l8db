"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

export function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}
