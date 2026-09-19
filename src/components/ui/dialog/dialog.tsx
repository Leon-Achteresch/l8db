"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

export function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}
