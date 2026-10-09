"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { usePortalContainer } from "@/lib/portal-container";

export function DialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const scopedContainer = usePortalContainer();
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container === undefined ? scopedContainer : container}
      {...props}
    />
  );
}
