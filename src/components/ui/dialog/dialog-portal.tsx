"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

export function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}
