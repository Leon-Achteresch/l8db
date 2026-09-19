"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

export function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
