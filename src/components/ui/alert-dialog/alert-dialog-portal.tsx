import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import * as React from "react";
import { usePortalContainer } from "@/lib/portal-container";

export function AlertDialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const scopedContainer = usePortalContainer();
  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      container={container === undefined ? scopedContainer : container}
      {...props}
    />
  );
}
