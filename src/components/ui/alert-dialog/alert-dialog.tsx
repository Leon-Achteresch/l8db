import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import * as React from "react";

export function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}
