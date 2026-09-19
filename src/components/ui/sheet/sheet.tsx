import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

export function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}
