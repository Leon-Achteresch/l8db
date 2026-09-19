import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

export function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}
